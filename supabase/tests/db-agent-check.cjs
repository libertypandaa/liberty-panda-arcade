const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); }
catch { ({ PGlite } = require('../../output/qa/electric-sql-pglite/package')); }
const root = path.resolve(__dirname, '../..');
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'live-schema.fixture.json'), 'utf8'));
const evidence = { production: false, engine: 'PGlite', cases: [], limitations: [] };
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
    for (const file of ['20260920_profiles.sql', '20260920_analytics.sql', '20260920_game_analytics.sql']) {
      await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
    }
    // Use current live function bodies, rather than assuming historical files match.
    for (const fn of snapshot.functions) await db.exec(fn.ddl);
    const local = await db.query(`select c.relname as table, co.conname as name, pg_get_constraintdef(co.oid) as definition
      from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and co.contype<>'n'`);
    const canonical = rows => rows.map(r => JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b))))).sort();
    evidence.postgresVersion=(await db.query('select version() v')).rows[0].v;
    assert.deepEqual(canonical(local.rows), canonical(snapshot.constraints));
    const indexes = await db.query("select indexname,indexdef from pg_indexes where schemaname='public'");
    assert.deepEqual(canonical(indexes.rows), canonical(snapshot.indexes.map(({indexname,indexdef}) => ({indexname,indexdef}))));
    const grants = await db.query("select grantee,table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')");
    assert.deepEqual(canonical(grants.rows), canonical(snapshot.grants.map(({grantee,table_name,privilege_type})=>({grantee,table_name,privilege_type}))));
    const policies = await db.query("select policyname,cmd,roles,qual,with_check from pg_policies where schemaname='public'");
    assert.deepEqual(canonical(policies.rows),canonical(snapshot.policies.map(({policyname,cmd,roles,qual,with_check})=>({policyname,cmd,roles,qual,with_check}))));
    evidence.cases.push('Live constraints, indexes, table grants and profile policies match reconstructed baseline; live function bodies loaded');
    const A = randomUUID(), B = randomUUID();
    const identity = async user => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user || '']);
      await db.exec('set local role authenticated');
    };
    const rejects = async (sql, args, message) => {
      await db.exec('savepoint expected_rejection');
      let caught;
      try { await db.query(sql, args); } catch (error) { caught = error; }
      await db.exec('rollback to savepoint expected_rejection; release savepoint expected_rejection');
      assert.ok(caught, 'Expected rejection: ' + message);
      assert.match(caught.message, message);
    };
    const event = (session, game, name, data, id=randomUUID()) => db.query(
      'select public.record_game_event($1,null,$2,$3,$4,$5::jsonb)', [id,session,game,name,JSON.stringify(data)]);
    const stats = async () => (await db.query('select public.my_game_stats(null) as value')).rows[0].value;
    await db.exec('begin');
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,'a@example.invalid','{\"name\":\"Player A\"}'),($2,'b@example.invalid','{\"name\":\"Player B\"}')", [A,B]);
    await identity(A);
    await rejects("select public.record_hub_event($1,null,'launch','clutter-cup')", [randomUUID()], /hub_events_game_check/);
    await rejects('select public.record_game_event($1,null,$2,\'clutter-cup\',\'session_start\',\'{}\')', [randomUUID(),randomUUID()], /Invalid identity or game/);
    evidence.cases.push('Live baseline rejects Clutter Cup hub launch and game session before extension');
    // End fixture transaction before migration's own BEGIN/COMMIT.
    await db.exec('rollback; reset role');
    const unchangedMetadata = async () => {
      const queries = [
        "select p.proname,pg_get_functiondef(p.oid) ddl,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname<>'record_game_event'",
        "select c.relname,co.conname,pg_get_constraintdef(co.oid) definition from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and co.conname not in ('hub_events_game_check','game_analytics_sessions_game_check')",
        "select * from pg_policies where schemaname='public'",
        "select indexname,indexdef from pg_indexes where schemaname='public'",
        "select tablename,rowsecurity from pg_tables where schemaname='public'",
        "select grantee,table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')"
      ];
      const rows=[]; for (const sql of queries) rows.push(canonical((await db.query(sql)).rows)); return rows;
    };
    const preservedBefore=await unchangedMetadata();
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260927_clutter_cup.sql'),'utf8'));
    assert.deepEqual(await unchangedMetadata(),preservedBefore);
    evidence.cases.push('Extension preserves all other function definitions/ACL, constraints, indexes, RLS, policies and table grants');
    await db.exec('begin');
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values ($1,'a@example.invalid','{\"name\":\"Player A\"}'),($2,'b@example.invalid','{\"name\":\"Player B\"}')", [A,B]);
    const fixtures=[];
    for (const [user,cfScore,ccScore] of [[A,120,65000],[B,90,43000]]) {
      await identity(user);
      for (const [game,score] of [['crystal-front-demo',cfScore],['clutter-cup',ccScore]]) {
        const session=randomUUID(), result=randomUUID();
        const match='shared_match'; // Same match key across accounts/games must remain isolated.
        await db.query('select public.record_hub_event($1,null,\'launch\',$2)',[randomUUID(),game]);
        await event(session,game,'session_start',{});
        await event(session,game,'ready',{load_ms:100});
        await event(session,game,'match_start',{match,mode:'fixture'});
        await event(session,game,'match_end',{match,outcome:'win',score},result);
        await event(session,game,'match_end',{match,outcome:'win',score},result);
        await event(session,game,'match_end',{match,outcome:'win',score:score+1});
        fixtures.push({user,game,score,session,result});
      }
      const report=await stats();
      assert.equal(report.length,2);
      for (const f of fixtures.filter(f=>f.user===user)) {
        const row=report.find(r=>r.game===f.game);
        assert.equal(row.sessions,1); assert.equal(row.wins,1); assert.equal(row.matches,1); assert.equal(row.avgScore,f.score);
      }
      assert.equal((await db.query('select public.my_hub_stats(null) as value')).rows[0].value.launches,2);
      assert.equal((await db.query('select id from public.profiles')).rows.length,1);
      assert.equal((await db.query('select id from public.profiles')).rows[0].id,user);
    }
    evidence.cases.push('Two populated authenticated players x two games: separate scores, sessions, wins, hub history and profiles');
    evidence.cases.push('Four original match results + exact event-ID retry + different event-ID retry: each match remains one immutable result');
    await identity(B);
    const foreign=fixtures.find(f=>f.user===A && f.game==='clutter-cup');
    const own=fixtures.find(f=>f.user===B && f.game==='clutter-cup');
    const before=JSON.stringify(await stats());
    await rejects('select public.record_game_event($1,null,$2,\'clutter-cup\',\'error\',\'{"code":"intrusion"}\')',[randomUUID(),foreign.session],/Session not owned/);
    await rejects('select public.record_game_event($1,null,$2,\'clutter-cup\',\'session_start\',\'{}\')',[randomUUID(),foreign.session],/Session not owned/);
    await rejects('select public.record_game_event($1,null,$2,\'crystal-front-demo\',\'error\',\'{"code":"wrong_game"}\')',[randomUUID(),own.session],/Session not owned/);
    await rejects('select public.record_game_event($1,null,$2,\'unknown-game\',\'session_start\',\'{}\')',[randomUUID(),randomUUID()],/Invalid identity or game/);
    await rejects('select public.record_game_event($1,null,$2,\'clutter-cup\',\'match_end\',\'{"match":"missing","outcome":"win","score":1}\')',[randomUUID(),own.session],/Match not started/);
    for(const score of [-1,1.5]) await rejects('select public.record_game_event($1,null,$2,\'clutter-cup\',\'match_end\',$3::jsonb)',[randomUUID(),own.session,JSON.stringify({match:'shared_match',outcome:'win',score})],/Invalid finish milliseconds/);
    await rejects('select public.record_game_event($1,null,$2,\'clutter-cup\',\'custom\',\'{"name":"bomb_used","value":1}\')',[randomUUID(),own.session],/Unregistered custom event/);
    assert.equal(JSON.stringify(await stats()),before);
    evidence.cases.push('Foreign player/session, wrong game, unknown game, unstarted match, invalid finish time and unregistered custom event rejected; owner data unchanged');
    assert.equal((await db.query("update public.profiles set display_name='intrusion' where id=$1 returning id",[A])).rows.length,0);
    await rejects('update public.profiles set id=$1 where id=$2',[A,B],/row-level security/);
    await rejects("insert into public.profiles(id,display_name) values($1,'intrusion')",[A],/row-level security/);
    for(const table of ['hub_events','game_analytics_sessions','game_analytics_events','hub_analytics_admins','game_analytics_custom']) {
      await rejects('select * from public.'+table,[],/permission denied/);
      await rejects('delete from public.'+table,[],/permission denied/);
    }
    await rejects('select public.admin_game_stats()',[],/Not authorized/);
    await rejects('select public.hub_admin_stats()',[],/Not authorized/);
    await rejects('select public.game_stats_for(null)',[],/permission denied/);
    assert.equal(JSON.stringify((await db.query('select public.my_game_stats($1) as value',[A])).rows[0].value),before);
    evidence.cases.push('Foreign profile UPDATE changes zero rows; ID reassignment/foreign INSERT denied; private tables and admin/internal reports denied; guest parameter cannot override JWT identity');
    // Known global event ID short-circuits before ownership. It must not modify a foreign row.
    await event(foreign.session,'clutter-cup','match_end',{match:'shared_match',outcome:'loss',score:1},foreign.result);
    evidence.limitations.push('Known existing p_id short-circuits before session ownership: foreign replay returns success/no-op, not explicit rejection. Same ID with changed body is not rejected. This analytics RPC is not a strict submissionId protocol for saves/rewards.');
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int n from public.game_analytics_events where name=\'match_end\'')).rows[0].n,4);
    assert.deepEqual((await db.query('select data from public.game_analytics_events where id=$1',[foreign.result])).rows[0].data,{match:'shared_match',outcome:'win',score:65000});
    await identity(A); const ABefore=JSON.stringify(await stats());
    await identity(B); await db.query('select public.delete_my_hub_stats($1)',[A]);
    assert.deepEqual(await stats(),[]);
    await identity(A); assert.equal(JSON.stringify(await stats()),ABefore);
    assert.equal((await db.query('select display_name from public.profiles')).rows[0].display_name,'Player A');
    evidence.cases.push('Deleting B statistics removes B only, even with A guest argument; A results and profile remain intact');
    await db.exec('rollback; reset role');
    for(const table of ['profiles','hub_events','game_analytics_sessions','game_analytics_events']) assert.equal((await db.query('select count(*)::int n from public.'+table)).rows[0].n,0);
    evidence.rollbackVerified=true; evidence.passed=true;
    fs.writeFileSync(path.join(root,'output/db-agent-check.json'),JSON.stringify(evidence,null,2));
    evidence.cases.forEach(c=>console.log('PASS '+c));
    console.log('LIMITATION '+evidence.limitations[0]); console.log('PASS rollback, no production writes');
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
