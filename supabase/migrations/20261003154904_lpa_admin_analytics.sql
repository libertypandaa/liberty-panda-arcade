-- LOCAL CANDIDATE. Membership assignment NOT included; separate /admin/ UI.
begin;
create index game_events_created_session on public.game_analytics_events(created_at,session);
create function lpa_private.require_admin() returns uuid language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();begin
 if actor is null then raise exception 'authentication_required' using errcode='28000'; end if;
 if not exists(select 1 from public.hub_analytics_admins where user_id=actor) then raise exception 'admin_forbidden' using errcode='42501'; end if;
 return actor;
end;$$;
create function lpa_api.admin_access() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform lpa_private.require_admin();return jsonb_build_object('contractVersion',1,'access',jsonb_build_object('allowed',true),'permissions',jsonb_build_array('analytics:read'));end;$$;
create function lpa_api.admin_analytics(p_game_id text,p_date_from date,p_date_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;start_utc timestamptz;end_utc timestamptz;
begin
 perform lpa_private.require_admin();
 if p_date_from is null or p_date_to is null or not isfinite(p_date_from) or not isfinite(p_date_to) then raise exception 'invalid_date_range'; end if;
 if p_date_to<p_date_from or p_date_to-p_date_from>30 then raise exception 'invalid_date_range'; end if;
 if p_game_id is not null and not exists(select 1 from lpa_private.games where game_id=p_game_id) then raise exception 'game_unavailable'; end if;
 start_utc:=p_date_from::timestamp at time zone 'UTC';end_utc:=(p_date_to+1)::timestamp at time zone 'UTC';
 with g as materialized (select * from lpa_private.games where p_game_id is null or game_id=p_game_id),
 ev as materialized (
  select s.game,s.actor,e.name,(e.created_at at time zone 'UTC')::date as utc_day,e.data->>'outcome' outcome,
   case when e.name='active_time' and jsonb_typeof(e.data->'seconds')='number' then (e.data->>'seconds')::numeric else 0 end seconds,
   case when e.name='match_end' and jsonb_typeof(e.data->'score')='number' then (e.data->>'score')::numeric end score
  from public.game_analytics_events e join public.game_analytics_sessions s on s.id=e.session join g on g.game_id=s.game where e.created_at>=start_utc and e.created_at<end_utc
 ), ss as materialized (
  select s.game,(s.started_at at time zone 'UTC')::date as utc_day from public.game_analytics_sessions s join g on g.game_id=s.game where s.started_at>=start_utc and s.started_at<end_utc
 ), days as (select d::date as utc_day from generate_series(p_date_from::timestamp,p_date_to::timestamp,interval '1 day') d),
 daily_events as (
  select game,utc_day,count(distinct actor) players,coalesce(sum(seconds),0) seconds,count(*) filter(where name='match_end') matches,
   count(*) filter(where name='match_end' and outcome in ('win','loss','draw')) completed,
   count(*) filter(where name='match_end' and outcome='win') wins,count(*) filter(where name='match_end' and outcome='loss') losses,
   count(*) filter(where name='match_end' and outcome='draw') draws,count(*) filter(where name='match_end' and outcome='abandon') abandons,count(*) filter(where name='error') errors from ev group by game,utc_day
 ), daily_sessions as (select game,utc_day,count(*) sessions from ss group by game,utc_day)
 select jsonb_build_object('contractVersion',1,'access',jsonb_build_object('allowed',true),'generatedAt',now(),
  'filter',jsonb_build_object('gameId',p_game_id,'dateFrom',p_date_from,'dateTo',p_date_to,'timeZone','UTC'),
  'games',(select coalesce(jsonb_agg(jsonb_build_object('id',game_id,'title',title,'scoreUnit',score_unit) order by game_id),'[]'::jsonb) from lpa_private.games),
  'summary',(select jsonb_build_object('players',count(distinct actor),'sessions',(select count(*) from ss),'activeSeconds',coalesce(sum(seconds),0),
   'matches',count(*) filter(where name='match_end'),'completedMatches',count(*) filter(where name='match_end' and outcome in ('win','loss','draw')),
   'wins',count(*) filter(where name='match_end' and outcome='win'),'losses',count(*) filter(where name='match_end' and outcome='loss'),
   'draws',count(*) filter(where name='match_end' and outcome='draw'),'abandons',count(*) filter(where name='match_end' and outcome='abandon'),'errors',count(*) filter(where name='error'),'installations',null) from ev),
  'activity',(select coalesce(jsonb_agg(jsonb_build_object('date',d.utc_day,'gameId',g.game_id,'players',coalesce(e.players,0),'sessions',coalesce(s.sessions,0),'activeSeconds',coalesce(e.seconds,0),'matches',coalesce(e.matches,0),'completedMatches',coalesce(e.completed,0),'wins',coalesce(e.wins,0),'losses',coalesce(e.losses,0),'draws',coalesce(e.draws,0),'abandons',coalesce(e.abandons,0),'errors',coalesce(e.errors,0)) order by d.utc_day,g.game_id),'[]'::jsonb) from days d cross join g left join daily_events e on e.game=g.game_id and e.utc_day=d.utc_day left join daily_sessions s on s.game=g.game_id and s.utc_day=d.utc_day),
  'results',(select coalesce(jsonb_agg(r.result_row order by r.game_id),'[]'::jsonb) from (
   select g.game_id,jsonb_build_object('gameId',g.game_id,'scoreUnit',g.score_unit,'matches',count(e.name) filter(where e.name='match_end'),'completedMatches',count(e.name) filter(where e.name='match_end' and e.outcome in ('win','loss','draw')),
    'wins',count(e.name) filter(where e.name='match_end' and e.outcome='win'),'losses',count(e.name) filter(where e.name='match_end' and e.outcome='loss'),'draws',count(e.name) filter(where e.name='match_end' and e.outcome='draw'),'abandons',count(e.name) filter(where e.name='match_end' and e.outcome='abandon'),
    'meanScore',case when g.score_unit='none' then null else avg(e.score) filter(where e.name='match_end' and e.outcome in ('win','loss','draw')) end) as result_row from g left join ev e on e.game=g.game_id group by g.game_id,g.score_unit
  ) r),
  'versions',(select coalesce(jsonb_agg(jsonb_build_object('gameId',game,'version',null,'buildId',null,'sourceCommit',null,'sessions',sessions) order by game),'[]'::jsonb) from (select game,count(*) sessions from ss group by game) v),
  'limitations',jsonb_build_object('buildMetadata','unavailable','installations','unavailable','serverValidatedResults',false,'economyEnabled',false)) into result;
 return result;
end;$$;
create function public.lpa_admin_access() returns jsonb language sql stable security invoker set search_path='' as $$select lpa_api.admin_access();$$;
create function public.lpa_admin_analytics(p_game_id text default null,p_date_from date default null,p_date_to date default null) returns jsonb language sql stable security invoker set search_path='' as $$select lpa_api.admin_analytics(p_game_id,p_date_from,p_date_to);$$;
revoke all on function lpa_private.require_admin() from public,anon,authenticated,service_role;
revoke all on function lpa_api.admin_access(),lpa_api.admin_analytics(text,date,date),public.lpa_admin_access(),public.lpa_admin_analytics(text,date,date) from public,anon,authenticated,service_role;
grant execute on function lpa_api.admin_access(),lpa_api.admin_analytics(text,date,date),public.lpa_admin_access(),public.lpa_admin_analytics(text,date,date) to authenticated;
commit;
