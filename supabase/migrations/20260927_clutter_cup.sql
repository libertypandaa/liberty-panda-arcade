-- Register Clutter Cup without changing applied migrations, RLS, ownership or limits.
begin;
alter table public.hub_events drop constraint hub_events_game_check;
alter table public.hub_events add constraint hub_events_game_check check (game is null or game in ('crystal-front-demo','clutter-cup'));
alter table public.game_analytics_sessions drop constraint game_analytics_sessions_game_check;
alter table public.game_analytics_sessions add constraint game_analytics_sessions_game_check check (game in ('crystal-front-demo','clutter-cup'));
-- Custom events remain disabled: no allowlist entries for Clutter Cup.
create or replace function public.record_game_event(p_id uuid,p_guest uuid,p_session uuid,p_game text,p_name text,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare a text:=public.hub_actor(p_guest); s public.game_analytics_sessions;
  allowed text[]; required text[]; k text; secs integer;
begin
  if a is null or p_id is null or p_session is null or (p_game is null or p_game not in ('crystal-front-demo','clutter-cup')) then raise exception 'Invalid identity or game'; end if;
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
  if p_game='clutter-cup' and p_name='match_end' and ((p_data->>'score')::numeric<0 or (p_data->>'score')::numeric<>trunc((p_data->>'score')::numeric)) then raise exception 'Invalid finish milliseconds'; end if;
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
