begin;
create table public.game_analytics_sessions (
  id uuid primary key, actor text not null,
  user_id uuid references auth.users(id) on delete cascade,
  game text not null check(game in ('crystal-front-demo')),
  started_at timestamptz not null default now(), last_event_at timestamptz not null default now(),
  ended_at timestamptz, active_seconds integer not null default 0
);
create index game_sessions_actor on public.game_analytics_sessions(actor,started_at);
create table public.game_analytics_events (
  id uuid primary key, session uuid not null references public.game_analytics_sessions(id) on delete cascade,
  name text not null, data jsonb not null, created_at timestamptz not null default now()
);
create index game_events_session on public.game_analytics_events(session,name);
create unique index game_events_once on public.game_analytics_events(session,name)
  where name in ('session_start','ready','session_end');
create unique index game_match_once on public.game_analytics_events(session,name,(data->>'match'))
  where name in ('match_start','match_end');
create unique index game_achievement_once on public.game_analytics_events(session,(data->>'achievement'))
  where name='achievement';
create table public.game_analytics_custom (
  game text not null, name text not null check(name ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'), primary key(game,name)
);
insert into public.game_analytics_custom values
 ('crystal-front-demo','bomb_used'),('crystal-front-demo','line_used'),
 ('crystal-front-demo','color_used'),('crystal-front-demo','shuffle_used');
alter table public.game_analytics_sessions enable row level security;
alter table public.game_analytics_events enable row level security;
alter table public.game_analytics_custom enable row level security;
revoke all on public.game_analytics_sessions,public.game_analytics_events,public.game_analytics_custom from anon,authenticated;

create function public.record_game_event(p_id uuid,p_guest uuid,p_session uuid,p_game text,p_name text,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare a text:=public.hub_actor(p_guest); s public.game_analytics_sessions;
  allowed text[]; required text[]; k text; secs integer;
begin
  if a is null or p_id is null or p_session is null or p_game is distinct from 'crystal-front-demo' then raise exception 'Invalid identity or game'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>512 then raise exception 'Invalid payload'; end if;
  case p_name
    when 'session_start','session_end' then allowed:=array[]::text[];
    when 'ready' then allowed:=array['load_ms'];
    when 'active_time' then allowed:=array['seconds'];
    when 'match_start' then allowed:=array['match','mode'];
    when 'match_end' then allowed:=array['match','outcome','score'];
    when 'tutorial' then allowed:=array['step','state'];
    when 'progress' then allowed:=array['level','percent'];
    when 'achievement' then allowed:=array['achievement'];
    when 'error' then allowed:=array['code'];
    when 'custom' then allowed:=array['name','value'];
    else raise exception 'Unknown event';
  end case;
  if not (p_data ?& allowed) or exists(select 1 from jsonb_object_keys(p_data) t(key) where not(key=any(allowed))) then raise exception 'Invalid fields'; end if;
  foreach k in array allowed loop
    if k=any(array['load_ms','seconds','score','percent','value']) then
      if jsonb_typeof(p_data->k)<>'number' or abs((p_data->>k)::numeric)>1000000 then raise exception 'Invalid number'; end if;
    elsif jsonb_typeof(p_data->k)<>'string' or not((p_data->>k) ~ '^[a-z0-9][a-z0-9_.-]{0,63}$') then raise exception 'Invalid code';
    end if;
  end loop;
  if p_name='ready' and (p_data->>'load_ms')::numeric not between 0 and 600000 then raise exception 'Invalid load time'; end if;
  if p_name='active_time' and ((p_data->>'seconds')::numeric not between 1 and 30 or (p_data->>'seconds')::numeric<>trunc((p_data->>'seconds')::numeric)) then raise exception 'Invalid active time'; end if;
  if p_name='match_end' and p_data->>'outcome' not in ('win','loss','draw','abandon') then raise exception 'Invalid outcome'; end if;
  if p_name='tutorial' and p_data->>'state' not in ('start','complete') then raise exception 'Invalid tutorial state'; end if;
  if p_name='progress' and (p_data->>'percent')::numeric not between 0 and 100 then raise exception 'Invalid progress'; end if;
  if p_name='custom' and not exists(select 1 from public.game_analytics_custom where game=p_game and name=p_data->>'name') then raise exception 'Unregistered custom event'; end if;
  -- Serialize per identity so concurrent tabs cannot bypass deduplication and caps.
  perform pg_advisory_xact_lock(hashtextextended(a,0));
  if exists(select 1 from public.game_analytics_events where id=p_id) then return; end if;
  if (select count(*) from public.game_analytics_events e join public.game_analytics_sessions x on x.id=e.session where x.actor=a and e.created_at>now()-interval '1 day')>=4000 then raise exception 'Daily telemetry limit'; end if;
  if p_name='session_start' then
    insert into public.game_analytics_sessions(id,actor,user_id,game) values(p_session,a,auth.uid(),p_game) on conflict(id) do nothing;
  end if;
  select * into s from public.game_analytics_sessions where id=p_session for update;
  if s.id is null or s.actor<>a or s.game<>p_game then raise exception 'Session not owned'; end if;
  if s.ended_at is not null then return; end if;
  if p_name='match_end' and not exists(select 1 from public.game_analytics_events where session=p_session and name='match_start' and data->>'match'=p_data->>'match') then raise exception 'Match not started'; end if;
  if p_name='achievement' and exists(select 1 from public.game_analytics_events e join public.game_analytics_sessions x on x.id=e.session where x.actor=a and x.game=p_game and e.name='achievement' and e.data->>'achievement'=p_data->>'achievement') then return; end if;
  if p_name='active_time' then
    if not exists(select 1 from public.game_analytics_events where session=p_session and name='ready') then raise exception 'Game not ready'; end if;
    secs:=(p_data->>'seconds')::integer;
    if s.active_seconds+secs>extract(epoch from now()-s.started_at)+2 then raise exception 'Active time exceeds session'; end if;
  end if;
  insert into public.game_analytics_events(id,session,name,data) values(p_id,p_session,p_name,p_data) on conflict do nothing;
  if found then
    update public.game_analytics_sessions set last_event_at=now(), active_seconds=active_seconds+coalesce(secs,0), ended_at=case when p_name='session_end' then now() else null end where id=p_session;
  end if;
end;
$$;
revoke all on function public.record_game_event(uuid,uuid,uuid,text,text,jsonb) from public;
grant execute on function public.record_game_event(uuid,uuid,uuid,text,text,jsonb) to anon,authenticated;

create function public.game_stats_for(p_actor text) returns jsonb
language sql stable security definer set search_path='' as $$
with s as (select * from public.game_analytics_sessions where p_actor is null or actor=p_actor),
e as (select e.*,s.actor,s.game from public.game_analytics_events e join s on s.id=e.session),
g as (select game,count(*) sessions,count(distinct actor) players,sum(active_seconds) active_seconds,
 round(avg(active_seconds),1) avg_active,count(*) filter(where ended_at is not null) ended,
 count(*) filter(where ended_at is null and last_event_at<now()-interval '24 hours') unfinished from s group by game)
select coalesce(jsonb_agg(jsonb_build_object(
 'game',g.game,'sessions',sessions,'players',players,'activeSeconds',active_seconds,'avgActiveSeconds',avg_active,'ended',ended,'unfinished',unfinished,
 'loaded',(select count(*) from e where game=g.game and name='ready'),
 'loadRate',(select round(100.0*count(*)/nullif(g.sessions,0),1) from e where game=g.game and name='ready'),
 'avgLoadMs',(select round(avg((data->>'load_ms')::numeric),1) from e where game=g.game and name='ready'),
 'p95LoadMs',(select percentile_cont(0.95) within group(order by (data->>'load_ms')::numeric) from e where game=g.game and name='ready'),
 'matches',(select count(*) from e where game=g.game and name='match_start'),
 'completed',(select count(*) from e where game=g.game and name='match_end' and data->>'outcome'<>'abandon'),
 'wins',(select count(*) from e where game=g.game and name='match_end' and data->>'outcome'='win'),
 'losses',(select count(*) from e where game=g.game and name='match_end' and data->>'outcome'='loss'),
 'draws',(select count(*) from e where game=g.game and name='match_end' and data->>'outcome'='draw'),
 'abandoned',(select count(*) from e where game=g.game and name='match_end' and data->>'outcome'='abandon'),
 'unresolved',(select count(*) from e start where start.game=g.game and start.name='match_start' and start.created_at<now()-interval '24 hours' and not exists(select 1 from e finish where finish.session=start.session and finish.name='match_end' and finish.data->>'match'=start.data->>'match')),
 'winRate',(select round(100.0*count(*) filter(where data->>'outcome'='win')/nullif(count(*) filter(where data->>'outcome'<>'abandon'),0),1) from e where game=g.game and name='match_end'),
 'avgScore',(select round(avg((data->>'score')::numeric),1) from e where game=g.game and name='match_end' and data->>'outcome'<>'abandon'),
 'achievements',(select count(*) from e where game=g.game and name='achievement'),
 'errors',(select count(*) from e where game=g.game and name='error'),
 'tutorial',(select coalesce(jsonb_agg(t),'[]') from (select data->>'step' step,count(distinct actor) filter(where data->>'state'='start') started,count(distinct actor) filter(where data->>'state'='complete') completed from e where game=g.game and name='tutorial' group by data->>'step' order by data->>'step') t),
 'progress',(select coalesce(jsonb_agg(t),'[]') from (select level,count(*) players,round(avg(percent),1) average_best_percent from (select actor,data->>'level' level,max((data->>'percent')::numeric) percent from e where game=g.game and name='progress' group by actor,data->>'level') best group by level order by level) t),
 'unlocks',(select coalesce(jsonb_agg(t),'[]') from (select data->>'achievement' achievement,count(distinct actor) players from e where game=g.game and name='achievement' group by data->>'achievement' order by data->>'achievement') t),
 'errorCodes',(select coalesce(jsonb_agg(t),'[]') from (select data->>'code' code,count(*) occurrences from e where game=g.game and name='error' group by data->>'code' order by data->>'code') t),
 'custom',(select coalesce(jsonb_agg(t),'[]') from (select data->>'name' name,count(*) events,sum((data->>'value')::numeric) total,round(avg((data->>'value')::numeric),2) average from e where game=g.game and name='custom' group by data->>'name' order by data->>'name') t)
)), '[]'::jsonb) from g;
$$;
revoke all on function public.game_stats_for(text) from public,anon,authenticated;

create function public.my_game_stats(p_guest uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select public.game_stats_for(coalesce(public.hub_actor(p_guest),'invalid'));
$$;
revoke all on function public.my_game_stats(uuid) from public;
grant execute on function public.my_game_stats(uuid) to anon,authenticated;
create function public.admin_game_stats() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.hub_analytics_admins where user_id=auth.uid()) then raise exception 'Not authorized' using errcode='42501'; end if;
 return public.game_stats_for(null);
end;
$$;
revoke all on function public.admin_game_stats() from public,anon;
grant execute on function public.admin_game_stats() to authenticated;
create or replace function public.delete_my_hub_stats(p_guest uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 delete from public.hub_events where actor=public.hub_actor(p_guest);
 delete from public.game_analytics_sessions where actor=public.hub_actor(p_guest);
end;
$$;
commit;
