begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

create policy "read own profile" on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy "insert own profile" on public.profiles
for insert to authenticated with check ((select auth.uid()) = id);
create policy "update own profile" on public.profiles
for update to authenticated using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create or replace function public.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''), 'Player'), 100),
    new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user_profile() from public, anon, authenticated;

create trigger on_auth_user_created_create_profile
after insert on auth.users for each row execute function public.handle_new_user_profile();

insert into public.profiles (id, display_name, avatar_url)
select id, left(coalesce(nullif(raw_user_meta_data ->> 'full_name', ''),
  nullif(raw_user_meta_data ->> 'name', ''), 'Player'), 100),
  raw_user_meta_data ->> 'avatar_url'
from auth.users on conflict (id) do nothing;

commit;
