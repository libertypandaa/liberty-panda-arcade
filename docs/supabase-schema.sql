-- Liberty Panda Arcade Supabase starter schema.
-- Run this in the Supabase SQL Editor after creating the project.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  genre text not null,
  description text not null,
  status text not null check (status in ('draft', 'demo', 'beta', 'released')),
  play_url text,
  cover_url text,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  score integer not null check (score >= 0),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  key text not null,
  title text not null,
  description text not null,
  points integer not null default 0 check (points >= 0),
  unique (game_id, key)
);

create table if not exists public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.progress enable row level security;
alter table public.scores enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;

drop policy if exists "authenticated users can read profiles" on public.profiles;
drop policy if exists "users can create own profile" on public.profiles;
drop policy if exists "users can update own profile" on public.profiles;
drop policy if exists "public games are readable" on public.games;
drop policy if exists "users can read own progress" on public.progress;
drop policy if exists "users can create own progress" on public.progress;
drop policy if exists "users can update own progress" on public.progress;
drop policy if exists "users can delete own progress" on public.progress;
drop policy if exists "signed in users can read scores" on public.scores;
drop policy if exists "users can submit own scores" on public.scores;
drop policy if exists "public achievements are readable" on public.achievements;
drop policy if exists "signed in users can read unlocked achievements" on public.user_achievements;
drop policy if exists "users can unlock own achievements" on public.user_achievements;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.games from anon, authenticated;
revoke all on table public.progress from anon, authenticated;
revoke all on table public.scores from anon, authenticated;
revoke all on table public.achievements from anon, authenticated;
revoke all on table public.user_achievements from anon, authenticated;

grant select on table public.games to anon, authenticated;
grant select on table public.profiles to authenticated;
grant select, insert, update, delete on table public.progress to authenticated;
grant select, insert on table public.scores to authenticated;
grant select on table public.achievements to anon, authenticated;
grant select, insert on table public.user_achievements to authenticated;
grant select, insert, update on table public.profiles to authenticated;

create policy "authenticated users can read profiles"
on public.profiles for select
to authenticated
using (true);

create policy "users can create own profile"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "users can update own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "public games are readable"
on public.games for select
to anon, authenticated
using (is_public = true);

create policy "users can read own progress"
on public.progress for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "users can create own progress"
on public.progress for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "users can update own progress"
on public.progress for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users can delete own progress"
on public.progress for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "signed in users can read scores"
on public.scores for select
to authenticated
using (true);

create policy "users can submit own scores"
on public.scores for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "public achievements are readable"
on public.achievements for select
to anon, authenticated
using (true);

create policy "signed in users can read unlocked achievements"
on public.user_achievements for select
to authenticated
using (true);

create policy "users can unlock own achievements"
on public.user_achievements for insert
to authenticated
with check ((select auth.uid()) = user_id);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), 'Player'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_profile on auth.users;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();

insert into public.games (slug, title, genre, description, status, play_url, cover_url, is_public)
values (
  'crystal-front-demo',
  'Crystal Front Demo',
  'Strategy · Tactical',
  'Тактическая кристальная дуэль от Lieberman Games.',
  'demo',
  'https://libertypandaa.github.io/crystal-front-demo/',
  '/assets/games/crystal-front-feature.png',
  true
)
on conflict (slug) do update set
  title = excluded.title,
  genre = excluded.genre,
  description = excluded.description,
  status = excluded.status,
  play_url = excluded.play_url,
  cover_url = excluded.cover_url,
  is_public = excluded.is_public,
  updated_at = now();
