-- All synthetic events are rolled back. Run after the analytics migration.
begin;
set local role anon;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); eid uuid := gen_random_uuid();
begin
  perform public.record_hub_event(eid,a,'visit',null);
  perform public.record_hub_event(gen_random_uuid(),a,'visit',null);
  perform public.record_hub_event(eid,a,'visit',null);
  perform public.record_hub_event(gen_random_uuid(),a,'launch','crystal-front-demo');
  if (public.my_hub_stats(a)->>'visits')::int <> 1 then raise exception 'Visit dedup failed'; end if;
  if (public.my_hub_stats(a)->>'launches')::int <> 1 then raise exception 'Launch count failed'; end if;
  if (public.my_hub_stats(b)->>'launches')::int <> 0 then raise exception 'Guest isolation failed'; end if;
  begin
    perform public.hub_admin_stats();
    raise exception 'Anon accessed admin report';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.hub_events limit 1;
    raise exception 'Anon accessed events table';
  exception when insufficient_privilege then null; end;
  begin
    perform public.record_hub_event(gen_random_uuid(),a,'invalid',null);
    raise exception 'Invalid kind accepted';
  exception when check_violation then null; end;
  perform public.delete_my_hub_stats(a);
  if (public.my_hub_stats(a)->>'visits')::int <> 0 then raise exception 'Deletion failed'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local role authenticated;
do $$
begin
  begin
    perform public.hub_admin_stats();
    raise exception 'Non-owner accessed admin report';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub',(select user_id::text from public.hub_analytics_admins limit 1),true);
set local role authenticated;
do $$
begin
  if public.hub_admin_stats()->>'daily' is null then raise exception 'Owner report failed'; end if;
end;
$$;
rollback;
select 'PASS: deduplication, guest isolation, private tables, admin authorization, validation, deletion, owner report' as result;
