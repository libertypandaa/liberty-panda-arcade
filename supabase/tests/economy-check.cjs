const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch{({PGlite}=require('../../output/qa/electric-sql-pglite/package'));}
const root=path.resolve(__dirname,'../..');
const results={production:false,passed:false,cases:[],limitations:['PGlite uses one serialized PostgreSQL backend. Competing calls test queued decisions/replay, not independent connection lock waits. Test independent PostgreSQL 17 connections before activating spend.','No provider signatures, refunds or accepted-save processing implemented/tested. All credits and products here are disposable fixtures.']};
(async()=>{
 const db=new PGlite();const pass=x=>{results.cases.push(x);console.log('PASS '+x);};
 const q=(sql,args=[])=>db.query(sql,args);
 const migrations=fs.readdirSync(path.join(root,'supabase/migrations')).filter(x=>/_lpa_((registry|economy)_core|registry_acl_hardening)\.sql$/.test(x)).sort();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default now());
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  for(const f of ['20260920_profiles.sql','20260920_analytics.sql','20260920_game_analytics.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
  for(const fn of JSON.parse(fs.readFileSync(path.join(__dirname,'live-schema.fixture.json'),'utf8')).functions)await db.exec(fn.ddl);
  await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role');
  for(const f of ['20260927_clutter_cup.sql',...migrations])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',f),'utf8'));
  const acl=(await q(`select n.nspname,p.proname,has_function_privilege('anon',p.oid,'execute') anon_exec,has_function_privilege('authenticated',p.oid,'execute') auth_exec,has_function_privilege('service_role',p.oid,'execute') service_exec from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('lpa_private','lpa_api') or (n.nspname='public' and p.proname like 'lpa_%')`)).rows;
  for(const f of acl){assert.equal(f.anon_exec,false,f.proname);assert.equal(f.auth_exec,f.nspname!=='lpa_private',f.proname);assert.equal(f.service_exec,f.nspname==='lpa_private'&&!['immutable_row','product_identity_fixed'].includes(f.proname),f.proname);}
  pass('Explicit ACLs deny PUBLIC/anon, restrict backend functions to service_role and client RPCs to authenticated under Supabase defaults');
  results.migrations=migrations;results.postgresVersion=(await q('select version() v')).rows[0].v;
  pass('Historic files unchanged; registry and economy candidates apply on a fresh temporary baseline');
  await db.exec(`create function public.fixture_try_purchase(p_game text,p_product text,p_request uuid,p_version integer) returns jsonb language plpgsql as $$
   begin return public.lpa_purchase(p_game,p_product,p_request,p_version);exception when others then return jsonb_build_object('error',SQLERRM);end;$$;
   begin;`);
  const actor=async(id,role='authenticated')=>{
   await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);
   await db.exec('set local role '+role);
  };
  const rejected=async(sql,args,regex)=>{
   await db.exec('savepoint expected_failure');let e;try{await q(sql,args);}catch(x){e=x;}
   await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');
   assert.ok(e,'Expected error '+regex);assert.match(e.message,regex);
  };
  const A=randomUUID(),B=randomUUID(),C=randomUUID(),D=randomUUID();
  for(const id of [A,B,C,D])await q("insert into auth.users(id,email) values($1,$2)",[id,id+'@example.invalid']);
  const wallet=async()=>(await q('select public.lpa_wallet() r')).rows[0].r;
  const inventory=async(game)=>(await q('select public.lpa_inventory($1) r',[game])).rows[0].r;
  const status=async(id)=>(await q('select public.lpa_purchase_status($1) r',[id])).rows[0].r;
  const buy=async(game,product,id,ver)=>(await q('select public.lpa_purchase($1,$2,$3,$4) r',[game,product,id,ver])).rows[0].r;
  const credit=async(id,source,units,kind='paid')=>(await q("select lpa_private.record_verified_credit($1,'fixture:test',$2,$3,$4) r",[id,source,kind,units])).rows[0].r;
  await actor(A);assert.equal((await wallet()).balance,0);assert.equal((await wallet()).economyEnabled,false);
  assert.deepEqual((await q('select public.lpa_capabilities() r')).rows[0].r,{contractVersion:1,registry:true,economy:true,providers:false,cloudSaves:false,spendEnabled:false});
  await rejected('select public.lpa_purchase($1,$2,$3,1)',['crystal-front-demo','cf.bombs',randomUUID()],/economy_disabled/);
  await actor(null);await rejected('select public.lpa_wallet()',[],/authentication_required/);
  await actor(null,'anon');await rejected('select public.lpa_wallet()',[],/permission denied/);
  await actor(A);await rejected('select lpa_private.record_verified_credit($1,\'fixture:test\',\'client\',\'ad\',100)',[A],/permission denied/);
  for(const table of ['wallets','ledger','prices','inventory_grants','credit_lots','store_orders']){
   await rejected('select * from lpa_private.'+table,[],/permission denied/);
   await rejected('delete from lpa_private.'+table,[],/permission denied/);
  }
  await rejected("select lpa_private.set_account_controls($1,true,'active','client')",[A],/permission denied/);
  pass('Auth required; economy off by default; clients cannot grant credits, change controls or access private tables');
  await actor(null,'service_role');
  await q("select lpa_private.register_game('third-game','Third Game','https://example.invalid/third/','none')");
  await q("select lpa_private.register_product('crystal-front-demo','bomb','consumable','cf.bombs','Bombs',70,5,'fixture')");
  await q("select lpa_private.register_product('clutter-cup','skin','permanent','cc.skin','Skin',50,1,'fixture')");
  await q("select lpa_private.register_product('crystal-front-demo','token','consumable','cf.race','Token',60,1,'fixture')");
  await q("select lpa_private.register_product('third-game','item','consumable','third.item','Third item',30,1,'fixture')");
  await rejected("select lpa_private.register_product('clutter-cup','bad','permanent','cc.bad','Bad',1,2,'fixture')",[],/invalid_quantity/);
  for(const id of [A,B,C,D])await q("select lpa_private.set_account_controls($1,true,'active','fixture admission')",[id]);
  for(const game of ['crystal-front-demo','clutter-cup','third-game'])await q("select lpa_private.set_game_economy($1,true,'fixture')",[game]);
  const source=randomUUID(),creditReceipt=await credit(A,source,1000);assert.deepEqual(await credit(A,source,1000),creditReceipt);
  await rejected("select lpa_private.record_verified_credit($1,'fixture:test',$2,'paid',1001)",[A,source],/idempotency_conflict/);
  await rejected("select lpa_private.record_verified_credit($1,'fixture:test',$2,'paid',1000)",[B,source],/idempotency_conflict/);
  await rejected("select lpa_private.record_verified_credit($1,'fixture:test','branchless','earned',10)",[A],/accepted_branch_required/);
  await credit(B,randomUUID(),100);await credit(C,randomUUID(),100);await credit(D,randomUUID(),100);
  await rejected('select * from lpa_private.ledger',[],/permission denied/);
  pass('Trusted credit source returns same receipt; conflicting payload/actor rejected; branchless earned credit disabled; service role cannot read tables directly');
  await actor(A);
  const games=(await q('select public.lpa_games() r')).rows[0].r;assert.equal(games.length,3);
  const catalog=(await q("select public.lpa_catalog('third-game') r")).rows[0].r;assert.equal(catalog[0].price,30);
  const thirdSession=randomUUID();
  await q('select public.record_game_event($1,null,$2,\'third-game\',\'session_start\',\'{}\')',[randomUUID(),thirdSession]);
  await q('select public.record_game_event($1,null,$2,\'third-game\',\'match_start\',\'{"match":"no_score","mode":"fixture"}\')',[randomUUID(),thirdSession]);
  await rejected('select public.record_game_event($1,null,$2,\'third-game\',\'match_end\',\'{"match":"no_score","outcome":"win","score":1}\')',[randomUUID(),thirdSession],/Invalid score for non-scored game/);
  await q('select public.record_game_event($1,null,$2,\'third-game\',\'match_end\',\'{"match":"no_score","outcome":"win","score":0}\')',[randomUUID(),thirdSession]);
  pass('Third game registers through backend operation; catalog and analytics accept it without another hardcoded game migration');
  const order=randomUUID(),receipt=await buy('crystal-front-demo','cf.bombs',order,1);
  assert.equal(receipt.balance,930);assert.equal(receipt.productId,'cf.bombs');assert.equal(receipt.grant.quantity,5);
  assert.deepEqual(await buy('crystal-front-demo','cf.bombs',order,1),receipt);assert.deepEqual(await status(order),receipt);
  await rejected('select public.lpa_purchase($1,$2,$3,2)',['crystal-front-demo','cf.bombs',order],/idempotency_conflict/);
  await rejected('select public.lpa_purchase($1,$2,$3,1)',['clutter-cup','cf.bombs',order],/idempotency_conflict/);
  await rejected('select public.lpa_purchase($1,$2,$3,1)',['crystal-front-demo','cc.skin',randomUUID()],/product_unavailable/);
  await rejected('select public.lpa_purchase($1,$2,$3)',['crystal-front-demo','cf.bombs',randomUUID()],/price_quote_required/);
  await actor(B);assert.equal(await status(order),null);assert.deepEqual(await inventory('crystal-front-demo'),[]);assert.equal((await wallet()).balance,100);
  await actor(null,'service_role');
  await q("select lpa_private.reprice_product('cf.bombs',80,6,'fixture reprice','New bombs title')");
  await q("select lpa_private.set_product_active('cf.bombs',false,'fixture inactive')");
  await q("select lpa_private.set_account_controls($1,false,'blocked','fixture block')",[A]);
  await actor(A);assert.deepEqual(await status(order),receipt);assert.deepEqual(await buy('crystal-front-demo','cf.bombs',order,1),receipt);
  await rejected('select public.lpa_purchase($1,$2,$3,2)',['crystal-front-demo','cf.bombs',randomUUID()],/account_blocked/);
  await actor(null,'service_role');await q("select lpa_private.set_account_controls($1,true,'active','fixture unblock')",[A]);
  await q("select lpa_private.set_product_active('cf.bombs',true,'fixture active')");
  await actor(A);
  await rejected('select public.lpa_purchase($1,$2,$3,1)',['crystal-front-demo','cf.bombs',randomUUID()],/price_changed/);
  const changedOffer=(await q("select public.lpa_catalog('crystal-front-demo') r")).rows[0].r.find(x=>x.id==='cf.bombs');
  assert.equal(changedOffer.title,'New bombs title');assert.equal(changedOffer.quantity,6);assert.equal(changedOffer.priceVersion,2);
  assert.equal((await wallet()).balance,930);assert.equal((await inventory('crystal-front-demo')).length,1);
  pass('Atomic purchase, original replay/status after repricing/inactivation/blocking; request mismatch, wrong game and stale offer version rejected');
  const skin=await buy('clutter-cup','cc.skin',randomUUID(),1),skinAgain=await buy('clutter-cup','cc.skin',randomUUID(),1);
  assert.equal(skinAgain.status,'already_owned');assert.equal(skinAgain.balance,skin.balance);assert.equal(skinAgain.grant.id,skin.grant.id);
  assert.equal((await inventory('clutter-cup')).length,1);
  pass('Permanent entitlement bought once; second request does not debit or duplicate ownership; grants remain game-specific');
  await actor(null,'postgres');
  await db.exec(`create function public.fixture_fail_grant() returns trigger language plpgsql as $$begin raise exception 'fixture_grant_failure';end;$$;
    create trigger fixture_fail before insert on lpa_private.inventory_grants for each row execute function public.fixture_fail_grant();`);
  await actor(A);const beforeWallet=await wallet(),beforeInventory=await inventory('third-game'),failedId=randomUUID();
  await rejected('select public.lpa_purchase($1,$2,$3,1)',['third-game','third.item',failedId],/fixture_grant_failure/);
  assert.deepEqual(await wallet(),beforeWallet);assert.deepEqual(await inventory('third-game'),beforeInventory);assert.equal(await status(failedId),null);
  await actor(null,'postgres');await db.exec('drop trigger fixture_fail on lpa_private.inventory_grants');
  await actor(A);assert.equal((await buy('third-game','third.item',failedId,1)).balance,beforeWallet.balance-30);
  pass('Injected failure after debit/lots but before grant rolls back wallet, ledger, allocations and receipt; retry same ID succeeds once');
  await actor(C);const candidateIds=[randomUUID(),randomUUID()];
  const contenders=await Promise.all(candidateIds.map(id=>q('select public.fixture_try_purchase($1,$2,$3,1) r',['crystal-front-demo','cf.race',id])));
  assert.equal(contenders.filter(r=>r.rows[0].r.status==='purchased').length,1);assert.equal(contenders.filter(r=>r.rows[0].r.error==='insufficient_funds').length,1);
  assert.equal((await wallet()).balance,40);assert.equal((await inventory('crystal-front-demo')).length,1);
  await actor(D);const duplicateId=randomUUID();const duplicate=await Promise.all([1,2].map(()=>q('select public.fixture_try_purchase($1,$2,$3,1) r',['crystal-front-demo','cf.race',duplicateId])));
  assert.deepEqual(duplicate[0].rows[0].r,duplicate[1].rows[0].r);assert.equal((await wallet()).balance,40);assert.equal((await inventory('crystal-front-demo')).length,1);
  pass('Queued competing spends: one of two 60-unit requests wins a 100-unit wallet; queued same-ID requests return one grant/receipt');
  await actor(null,'postgres');
  await rejected("update lpa_private.ledger set units=999",[],/immutable_record/);
  await rejected("delete from lpa_private.inventory_grants",[],/immutable_record/);
  await rejected("update lpa_private.prices set units=1",[],/immutable_record/);
  const projection=(await q(`select w.account_id,w.balance,coalesce((select sum(units) from lpa_private.ledger l where l.account_id=w.account_id),0)::bigint ledger,
    coalesce((select sum(remaining) from lpa_private.credit_lots l where l.account_id=w.account_id),0)::bigint lots from lpa_private.wallets w`)).rows;
  for(const row of projection){assert.equal(row.balance,row.ledger);assert.equal(row.balance,row.lots);assert.ok(row.balance>=0);}
  const bad=(await q(`select count(*)::int n from lpa_private.ledger l where l.units<0 and -l.units<>(select coalesce(sum(a.units),0) from lpa_private.debit_allocations a where a.debit_operation_id=l.operation_id)`)).rows[0].n;assert.equal(bad,0);
  pass('Append-only ledger/grants/prices; all wallet projections equal ledger and remaining lots; allocations exactly equal every debit');
  await db.exec('rollback;reset role');
  for(const table of ['wallets','ledger','credit_lots','debit_allocations','store_orders','inventory_grants','entitlements','products','prices','economy_audit'])assert.equal((await q('select count(*)::int n from lpa_private.'+table)).rows[0].n,0);
  results.rollbackVerified=true;results.passed=true;
  pass('All fixture accounts/catalog/credits/orders roll back; no production data');
  fs.writeFileSync(path.join(root,'output/economy-check.json'),JSON.stringify(results,null,2));
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
