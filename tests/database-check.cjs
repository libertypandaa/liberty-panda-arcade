const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 fs.mkdirSync('output',{recursive:true});
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 insert into auth.users(id,email) values ('22222222-2222-4222-8222-222222222222','libertypandaa@gmail.com'),('11111111-1111-4111-8111-111111111111','fixture@example.invalid');`);
 for(const p of ['supabase/migrations/20260920_analytics.sql','supabase/migrations/20260920_game_analytics.sql','supabase/migrations/20260927_clutter_cup.sql','tests/analytics.sql','tests/game-analytics.sql']){
  await db.exec(fs.readFileSync(p,'utf8'));console.log('PASS',p);
 }
 const result=await db.query('select count(*)::int count from public.game_analytics_sessions');
 if(result.rows[0].count!==0)throw Error('Test transaction leaked');
 fs.writeFileSync('output/database-check.json',JSON.stringify({engine:'PGlite PostgreSQL',passed:true,production:false,rollbackVerified:true},null,2));
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
