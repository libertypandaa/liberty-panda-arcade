-- Per-schema default REVOKE does not remove PostgreSQL's global PUBLIC EXECUTE.
-- Explicit ACLs for the already deployed registry; no unrelated defaults changed.
begin;
revoke all on function lpa_private.register_game(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function lpa_private.register_game(text,text,text,text) to service_role;
revoke all on function lpa_api.require_actor(),lpa_api.games(),public.lpa_games() from public,anon,authenticated,service_role;
grant execute on function lpa_api.require_actor(),lpa_api.games(),public.lpa_games() to authenticated;
commit;
