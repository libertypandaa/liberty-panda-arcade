begin;
create table public.hub_events (
  id uuid primary key,
  actor text not null,
  user_id uuid references auth.users(id) on delete cascade,
  kind text not null check (kind in ('visit','launch','install_click','install_available','installed','game_ready','launch_error','auth_error')),
  game text check (game is null or game = 'crystal-front-demo'),
  created_at timestamptz not null default now()
);
create index hub_events_actor_time on public.hub_events(actor,created_at);
create index hub_events_time on public.hub_events(created_at);
alter table public.hub_events enable row level security;
revoke all on public.hub_events from anon,authenticated;

create function public.hub_actor(p_guest uuid) returns text
language sql stable set search_path = '' as $$
  select case when auth.uid() is not null then 'u:' || auth.uid()::text
    when p_guest is not null then 'g:' || encode(sha256(convert_to(p_guest::text, 'UTF8')), 'hex')
    else null end;
$$;
revoke all on function public.hub_actor(uuid) from public,anon,authenticated;

create function public.record_hub_event(p_id uuid,p_guest uuid,p_kind text,p_game text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor text := public.hub_actor(p_guest);
begin
  if v_actor is null or p_id is null then raise exception 'Identity required'; end if;
  if (select count(*) from public.hub_events where actor=v_actor and created_at > now()-interval '1 day') >= 500 then
    raise exception 'Daily event limit reached';
  end if;
  if p_kind='visit' and exists(select 1 from public.hub_events where actor=v_actor and kind='visit' and created_at > now()-interval '30 minutes') then return; end if;
  insert into public.hub_events(id,actor,user_id,kind,game)
  values(p_id,v_actor,auth.uid(),p_kind,p_game) on conflict(id) do nothing;
end;
$$;
revoke all on function public.record_hub_event(uuid,uuid,text,text) from public;
grant execute on function public.record_hub_event(uuid,uuid,text,text) to anon,authenticated;

create function public.my_hub_stats(p_guest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'visits',count(*) filter(where kind='visit'),
    'launches',count(*) filter(where kind='launch'),
    'firstSeen',min(created_at),
    'lastGame',(select game from public.hub_events where actor=public.hub_actor(p_guest) and kind='launch' order by created_at desc limit 1),
    'history',(select coalesce(jsonb_agg(row_to_json(h)),'[]'::jsonb) from
      (select game,created_at from public.hub_events where actor=public.hub_actor(p_guest) and kind='launch' order by created_at desc limit 10) h))
  from public.hub_events where actor=public.hub_actor(p_guest);
$$;
revoke all on function public.my_hub_stats(uuid) from public;
grant execute on function public.my_hub_stats(uuid) to anon,authenticated;

create function public.delete_my_hub_stats(p_guest uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.hub_events where actor=public.hub_actor(p_guest);
$$;
revoke all on function public.delete_my_hub_stats(uuid) from public;
grant execute on function public.delete_my_hub_stats(uuid) to anon,authenticated;

create table public.hub_analytics_admins(user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.hub_analytics_admins enable row level security;
revoke all on public.hub_analytics_admins from anon,authenticated;
insert into public.hub_analytics_admins select id from auth.users where email='libertypandaa@gmail.com';

create function public.hub_admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.hub_analytics_admins where user_id=auth.uid()) then raise exception 'Not authorized' using errcode='42501'; end if;
  select jsonb_build_object(
    'daily',count(distinct actor) filter(where created_at >= now()-interval '1 day'),
    'weekly',count(distinct actor) filter(where created_at >= now()-interval '7 days'),
    'monthly',count(distinct actor) filter(where created_at >= now()-interval '30 days'),
    'guestBrowsers',count(distinct actor) filter(where user_id is null),
    'accounts',count(distinct actor) filter(where user_id is not null),
    'visits',count(*) filter(where kind='visit'),
    'launches',count(*) filter(where kind='launch'),
    'ready',count(*) filter(where kind='game_ready'),
    'installClicks',count(*) filter(where kind='install_click'),
    'installAvailable',count(*) filter(where kind='install_available'),
    'installed',count(*) filter(where kind='installed'),
    'errors',count(*) filter(where kind in ('launch_error','auth_error')),
    'returning', (select count(*) from (select actor from public.hub_events where kind='visit' group by actor having count(distinct (created_at at time zone 'UTC')::date)>1) r),
    'registrations',(select count(*) from auth.users where created_at >= now()-interval '30 days'),
    'retention',(select jsonb_agg(jsonb_build_object('day',n,'eligible',eligible,'returned',returned)) from (
      select n, count(*) filter(where first_day <= (now() at time zone 'UTC')::date-n) eligible,
      count(*) filter(where first_day <= (now() at time zone 'UTC')::date-n and exists(select 1 from public.hub_events e where e.actor=f.actor and e.kind='visit' and (e.created_at at time zone 'UTC')::date=f.first_day+n)) returned
      from (select actor,min((created_at at time zone 'UTC')::date) first_day from public.hub_events where kind='visit' group by actor) f
      cross join (values(1),(7),(30)) d(n) group by n order by n
    ) cohorts)
  ) into result from public.hub_events;
  return result;
end;
$$;
revoke all on function public.hub_admin_stats() from public,anon;
grant execute on function public.hub_admin_stats() to authenticated;
commit;
