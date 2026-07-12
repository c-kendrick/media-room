-- Media Room foundation: multi-user collections, secure access, and future sharing hooks.
-- Apply with the Supabase CLI or the SQL Editor before wiring the browser app to Supabase.

create extension if not exists pgcrypto;

create type public.profile_role as enum ('member', 'admin');
create type public.media_section as enum ('screen', 'book', 'game');
create type public.media_type as enum ('film', 'television', 'book', 'game');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  role public.profile_role not null default 'member',
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz,
  rejected_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  constraint profiles_display_name_length check (char_length(trim(display_name)) between 2 and 80),
  constraint profiles_registration_state check (approved_at is null or rejected_at is null)
);

create unique index profiles_username_lower_key on public.profiles (lower(username));

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_title_length check (char_length(trim(title)) between 2 and 100),
  constraint collections_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  unique (owner_id),
  unique (slug)
);

create table public.shelves (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  section public.media_section not null,
  name text not null,
  position numeric(12, 6) not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shelves_name_length check (char_length(trim(name)) between 1 and 100),
  unique (collection_id, section, name)
);

create index shelves_collection_section_position_idx
  on public.shelves (collection_id, section, position);

create table public.media_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  type public.media_type not null,
  title text not null,
  year smallint,
  status text,
  priority text,
  notes text,
  poster_url text,
  creator text,
  director text,
  description text,
  format text,
  platforms text[] not null default '{}',
  genres text[] not null default '{}',
  rating numeric(3, 1),
  runtime integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_items_title_length check (char_length(trim(title)) between 1 and 300),
  constraint media_items_year_range check (year is null or year between 1000 and 3000),
  constraint media_items_rating_range check (rating is null or rating between 0 and 10),
  constraint media_items_runtime_range check (runtime is null or runtime > 0)
);

create index media_items_collection_type_idx
  on public.media_items (collection_id, type);

create table public.shelf_media_items (
  shelf_id uuid not null references public.shelves(id) on delete cascade,
  media_item_id uuid not null references public.media_items(id) on delete cascade,
  position numeric(12, 6) not null default 1000,
  created_at timestamptz not null default now(),
  primary key (shelf_id, media_item_id)
);

create index shelf_media_items_shelf_position_idx
  on public.shelf_media_items (shelf_id, position);

-- This table is intentionally UI-free in this pass. It supports the later
-- shared-interest marker without modifying the owner’s shelf membership.
create table public.media_interest (
  media_item_id uuid not null references public.media_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (media_item_id, user_id)
);

create index media_interest_media_item_idx on public.media_interest (media_item_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger collections_set_updated_at
before update on public.collections
for each row execute function public.set_updated_at();

create trigger shelves_set_updated_at
before update on public.shelves
for each row execute function public.set_updated_at();

create trigger media_items_set_updated_at
before update on public.media_items
for each row execute function public.set_updated_at();

-- A profile is created automatically by Supabase Auth. Passwords are handled
-- exclusively by Supabase Auth and never enter this schema or the browser app.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  requested_display_name text := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if requested_username !~ '^[a-z0-9][a-z0-9_-]{2,31}$' then
    requested_username := 'member-' || substring(new.id::text from 1 for 8);
  end if;

  if char_length(requested_display_name) < 2 then
    requested_display_name := 'New member';
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, requested_username, left(requested_display_name, 80));

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Security-definer helpers let policies perform authorization without recursive
-- RLS checks. They are not granted as public write APIs.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and approved_at is not null
  );
$$;

create or replace function public.can_manage_collection(target_collection_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.collections
      where id = target_collection_id
        and owner_id = auth.uid()
        and public.is_approved_user()
    );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_approved_user() from public;
revoke all on function public.can_manage_collection(uuid) from public;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_approved_user() to authenticated;
grant execute on function public.can_manage_collection(uuid) to authenticated;

-- This is the only public profile surface. It deliberately excludes approval
-- and role fields, which are available only to the account owner and admins.
create or replace view public.public_profiles
with (security_invoker = false)
as
  select id, username, display_name
  from public.profiles
  where approved_at is not null;

grant select on public.public_profiles to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.collections enable row level security;
alter table public.shelves enable row level security;
alter table public.media_items enable row level security;
alter table public.shelf_media_items enable row level security;
alter table public.media_interest enable row level security;

-- Public browsing is deliberate. Unapproved users can view collections but
-- cannot make changes. Profile approval and role data stay private; public
-- navigation uses public.public_profiles instead.
create policy "Users and admins can read private profiles"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy "Admins can update profiles"
on public.profiles for update to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Public can read collections"
on public.collections for select
using (true);

create policy "Approved owners can create collections"
on public.collections for insert to authenticated
with check (owner_id = auth.uid() and public.is_approved_user());

create policy "Owners and admins can update collections"
on public.collections for update to authenticated
using (public.can_manage_collection(id))
with check (public.can_manage_collection(id));

create policy "Owners and admins can delete collections"
on public.collections for delete to authenticated
using (public.can_manage_collection(id));

create policy "Public can read shelves"
on public.shelves for select
using (true);

create policy "Owners and admins can create shelves"
on public.shelves for insert to authenticated
with check (public.can_manage_collection(collection_id));

create policy "Owners and admins can update shelves"
on public.shelves for update to authenticated
using (public.can_manage_collection(collection_id))
with check (public.can_manage_collection(collection_id));

create policy "Owners and admins can delete shelves"
on public.shelves for delete to authenticated
using (public.can_manage_collection(collection_id));

create policy "Public can read media items"
on public.media_items for select
using (true);

create policy "Owners and admins can create media items"
on public.media_items for insert to authenticated
with check (public.can_manage_collection(collection_id));

create policy "Owners and admins can update media items"
on public.media_items for update to authenticated
using (public.can_manage_collection(collection_id))
with check (public.can_manage_collection(collection_id));

create policy "Owners and admins can delete media items"
on public.media_items for delete to authenticated
using (public.can_manage_collection(collection_id));

create policy "Public can read shelf membership"
on public.shelf_media_items for select
using (true);

create policy "Owners and admins can create shelf membership"
on public.shelf_media_items for insert to authenticated
with check (
  exists (
    select 1
    from public.shelves
    join public.media_items on media_items.id = media_item_id
    where shelves.id = shelf_id
      and shelves.collection_id = media_items.collection_id
      and public.can_manage_collection(shelves.collection_id)
  )
);

create policy "Owners and admins can update shelf membership"
on public.shelf_media_items for update to authenticated
using (
  exists (
    select 1
    from public.shelves
    where shelves.id = shelf_id
      and public.can_manage_collection(shelves.collection_id)
  )
)
with check (
  exists (
    select 1
    from public.shelves
    join public.media_items on media_items.id = media_item_id
    where shelves.id = shelf_id
      and shelves.collection_id = media_items.collection_id
      and public.can_manage_collection(shelves.collection_id)
  )
);

create policy "Owners and admins can delete shelf membership"
on public.shelf_media_items for delete to authenticated
using (
  exists (
    select 1
    from public.shelves
    where shelves.id = shelf_id
      and public.can_manage_collection(shelves.collection_id)
  )
);

create policy "Public can read interest markers"
on public.media_interest for select
using (true);

create policy "Approved users can add their own interest"
on public.media_interest for insert to authenticated
with check (user_id = auth.uid() and public.is_approved_user());

create policy "Users and admins can remove interest"
on public.media_interest for delete to authenticated
using (user_id = auth.uid() or public.is_admin());

-- Deliberately no public write policy for profiles. Registration creates a
-- pending profile via the Auth trigger; only an admin approves or manages it.
