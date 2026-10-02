-- Read-only inspection. Run with a project administrator; no user records returned.
select current_database(), current_user;
select schemaname, tablename, rowsecurity from pg_tables
where schemaname='public' and tablename in ('profiles','hub_events','game_analytics_sessions','game_analytics_events');
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname='public' and tablename in ('profiles','hub_events','game_analytics_sessions','game_analytics_events');
select c.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and con.conname in ('hub_events_game_check','game_analytics_sessions_game_check');
select to_regclass('supabase_migrations.schema_migrations') as migration_history_table;
-- If migration_history_table exists, inspect versions/names in that table separately.
select p.proname, p.prosecdef as security_definer, p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('record_game_event','my_game_stats','hub_admin_stats','admin_game_stats');
