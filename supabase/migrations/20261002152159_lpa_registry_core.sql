-- Server registry v1. Requires reviewed existing profiles/analytics baseline.
-- No provider/payment activation. No changes to historic migration files.
begin;
create schema lpa_private;
create schema lpa_api;
revoke all on schema lpa_private,lpa_api from public,anon,authenticated;
grant usage on schema lpa_private to service_role;
grant usage on schema lpa_api to authenticated;
alter default privileges in schema lpa_private revoke execute on functions from public;
alter default privileges in schema lpa_api revoke execute on functions from public;

create table lpa_private.games (
  game_id text primary key check(game_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  title text not null check(length(title) between 1 and 120),
  launch_url text not null check(launch_url ~ '^https://[^[:space:]?#]+/$'),
  score_unit text not null check(score_unit in ('points','milliseconds','none')),
  active boolean not null default true,
  analytics_enabled boolean not null default true,
  economy_enabled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table lpa_private.games enable row level security;
revoke all on lpa_private.games from public,anon,authenticated,service_role;
insert into lpa_private.games(game_id,title,launch_url,score_unit) values
 ('crystal-front-demo','Crystal Front Demo','https://libertypandaa.github.io/crystal-front-demo/','points'),
 ('clutter-cup','Clutter Cup','https://libertypandaa.github.io/clutter-cup-playtest/','milliseconds');

-- NULL remains allowed for non-game hub visits. Game deletion is restricted.
alter table public.hub_events drop constraint hub_events_game_check;
alter table public.hub_events add constraint hub_events_registered_game foreign key(game) references lpa_private.games(game_id);
alter table public.game_analytics_sessions drop constraint game_analytics_sessions_game_check;
alter table public.game_analytics_sessions add constraint game_sessions_registered_game foreign key(game) references lpa_private.games(game_id);

create function lpa_api.require_actor() returns uuid language plpgsql stable set search_path='' as $$
declare actor uuid:=auth.uid(); begin
 if actor is null then raise exception 'authentication_required' using errcode='28000'; end if;
 return actor;
end; $$;
grant execute on function lpa_api.require_actor() to authenticated;

create function lpa_api.games() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform lpa_api.require_actor();
 return (select coalesce(jsonb_agg(jsonb_build_object('id',game_id,'title',title,'url',launch_url,'scoreUnit',score_unit) order by game_id),'[]'::jsonb) from lpa_private.games where active);
end; $$;
grant execute on function lpa_api.games() to authenticated;
create function public.lpa_games() returns jsonb language sql stable security invoker set search_path='' as $$ select lpa_api.games(); $$;
revoke all on function public.lpa_games() from public,anon;
grant execute on function public.lpa_games() to authenticated;

-- Only trusted backend may register a game. Economy always starts disabled.
create function lpa_private.register_game(p_game_id text,p_title text,p_url text,p_score_unit text) returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into lpa_private.games(game_id,title,launch_url,score_unit) values(p_game_id,p_title,p_url,p_score_unit);
end; $$;
grant execute on function lpa_private.register_game(text,text,text,text) to service_role;

-- record_game_event is appended below from the tested Clutter Cup function,
-- with registry-based guard and score rule. No hardcoded future game list.
create or replace function public.record_game_event(p_id uuid,p_guest uuid,p_session uuid,p_game text,p_name text,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare a text:=public.hub_actor(p_guest); s public.game_analytics_sessions;
  allowed text[]; required text[]; k text; secs integer;
begin
  if a is null or p_id is null or p_session is null or (p_game is null or not exists(select 1 from lpa_private.games where game_id=p_game and analytics_enabled)) then raise exception 'Invalid identity or game'; end if;
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
  if exists(select 1 from lpa_private.games where game_id=p_game and score_unit='milliseconds') and p_name='match_end' and ((p_data->>'score')::numeric<0 or (p_data->>'score')::numeric<>trunc((p_data->>'score')::numeric)) then raise exception 'Invalid finish milliseconds'; end if;
  if exists(select 1 from lpa_private.games where game_id=p_game and score_unit='none') and p_name='match_end' and (p_data->>'score')::numeric<>0 then raise exception 'Invalid score for non-scored game'; end if;
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
commit;
