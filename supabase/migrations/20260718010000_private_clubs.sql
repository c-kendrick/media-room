create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint clubs_name_length check (char_length(trim(name)) between 2 and 80)
);

create unique index if not exists clubs_name_lower_key on public.clubs (lower(trim(name)));

create table if not exists public.club_memberships (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

create index if not exists club_memberships_user_idx on public.club_memberships (user_id, club_id);

alter table public.clubs enable row level security;
alter table public.club_memberships enable row level security;
revoke all on public.clubs from anon, authenticated;
revoke all on public.club_memberships from anon, authenticated;

create or replace function public.profile_is_active(target_profile_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = target_profile_id
      and p.approved_at is not null
      and p.rejected_at is null
      and p.deactivated_at is null
  );
$$;

create or replace function public.is_kit_profile(target_profile_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.collections c
    where c.owner_id = target_profile_id and c.slug = 'kits-collection'
  );
$$;

create or replace function public.shares_club_with(target_profile_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and exists (
    select 1
    from public.club_memberships mine
    join public.club_memberships theirs on theirs.club_id = mine.club_id
    where mine.user_id = auth.uid() and theirs.user_id = target_profile_id
  );
$$;

create or replace function public.can_view_profile(target_profile_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.profile_is_active(target_profile_id)
    and (
      public.is_admin()
      or target_profile_id = auth.uid()
      or public.is_kit_profile(target_profile_id)
      or public.shares_club_with(target_profile_id)
    );
$$;

create or replace function public.can_view_collection(target_collection_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1
    from public.collections c
    where c.id = target_collection_id
      and public.profile_is_active(c.owner_id)
      and (
        public.is_admin()
        or c.owner_id = auth.uid()
        or c.slug = 'kits-collection'
        or public.shares_club_with(c.owner_id)
      )
  );
$$;

create or replace function public.can_view_shelf(target_shelf_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.shelves s
    where s.id = target_shelf_id
      and ((s.deleted_at is null and public.can_view_collection(s.collection_id)) or public.can_manage_collection(s.collection_id))
  );
$$;

create or replace function public.can_view_media_item(target_media_item_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.media_items m
    where m.id = target_media_item_id
      and ((m.deleted_at is null and public.can_view_collection(m.collection_id)) or public.can_manage_collection(m.collection_id))
  );
$$;

create or replace function public.can_view_interest(target_media_item_id uuid, target_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.can_view_media_item(target_media_item_id)
    and public.can_view_profile(target_user_id);
$$;

create or replace view public.public_profiles
with (security_invoker = false)
as
  select id, username, display_name
  from public.profiles
  where public.can_view_profile(id);

drop policy if exists "Public can read collections" on public.collections;
drop policy if exists "Public can read approved collections" on public.collections;
drop policy if exists "Public can read active collections" on public.collections;
drop policy if exists "Club members can read collections" on public.collections;
create policy "Club members can read collections"
on public.collections for select
using (public.can_view_collection(id) or public.can_manage_collection(id));

drop policy if exists "Public can read shelves" on public.shelves;
drop policy if exists "Public can read active shelves" on public.shelves;
drop policy if exists "Public can read active collection shelves" on public.shelves;
drop policy if exists "Club members can read shelves" on public.shelves;
create policy "Club members can read shelves"
on public.shelves for select
using ((deleted_at is null and public.can_view_collection(collection_id)) or public.can_manage_collection(collection_id));

drop policy if exists "Public can read media items" on public.media_items;
drop policy if exists "Public can read active media" on public.media_items;
drop policy if exists "Public can read active collection media" on public.media_items;
drop policy if exists "Club members can read media" on public.media_items;
create policy "Club members can read media"
on public.media_items for select
using ((deleted_at is null and public.can_view_collection(collection_id)) or public.can_manage_collection(collection_id));

drop policy if exists "Public can read shelf membership" on public.shelf_media_items;
drop policy if exists "Public can read active collection membership" on public.shelf_media_items;
drop policy if exists "Club members can read shelf membership" on public.shelf_media_items;
create policy "Club members can read shelf membership"
on public.shelf_media_items for select
using (public.can_view_shelf(shelf_id) and public.can_view_media_item(media_item_id));

drop policy if exists "Public can read interest markers" on public.media_interest;
drop policy if exists "Public can read active collection interest" on public.media_interest;
drop policy if exists "Club members can read interest markers" on public.media_interest;
create policy "Club members can read interest markers"
on public.media_interest for select
using (public.can_view_interest(media_item_id, user_id));

create or replace function public.admin_list_clubs()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'member_ids', coalesce((select jsonb_agg(cm.user_id order by cm.created_at, cm.user_id) from public.club_memberships cm where cm.club_id = c.id), '[]'::jsonb)
    ) order by lower(c.name), c.id)
    from public.clubs c
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_create_club(club_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  cleaned_name text := trim(club_name);
  created public.clubs;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  insert into public.clubs (name) values (cleaned_name) returning * into created;
  return jsonb_build_object('id', created.id, 'name', created.name, 'member_ids', '[]'::jsonb);
end $$;

create or replace function public.admin_rename_club(target_club_id uuid, club_name text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.clubs set name = trim(club_name) where id = target_club_id;
  if not found then raise exception 'Club not found'; end if;
end $$;

create or replace function public.admin_delete_club(target_club_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  delete from public.clubs where id = target_club_id;
  if not found then raise exception 'Club not found'; end if;
end $$;

create or replace function public.admin_set_user_clubs(target_user_id uuid, target_club_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.profiles where id = target_user_id) then raise exception 'User not found'; end if;
  if exists (select 1 from unnest(coalesce(target_club_ids, '{}'::uuid[])) id where not exists (select 1 from public.clubs c where c.id = id)) then
    raise exception 'Unknown club';
  end if;
  delete from public.club_memberships where user_id = target_user_id;
  insert into public.club_memberships (club_id, user_id)
  select distinct id, target_user_id from unnest(coalesce(target_club_ids, '{}'::uuid[])) id;
end $$;

revoke all on function public.profile_is_active(uuid) from public;
revoke all on function public.is_kit_profile(uuid) from public;
revoke all on function public.shares_club_with(uuid) from public;
revoke all on function public.can_view_profile(uuid) from public;
revoke all on function public.can_view_collection(uuid) from public;
revoke all on function public.can_view_shelf(uuid) from public;
revoke all on function public.can_view_media_item(uuid) from public;
revoke all on function public.can_view_interest(uuid, uuid) from public;
revoke all on function public.admin_list_clubs() from public, anon;
revoke all on function public.admin_create_club(text) from public, anon;
revoke all on function public.admin_rename_club(uuid, text) from public, anon;
revoke all on function public.admin_delete_club(uuid) from public, anon;
revoke all on function public.admin_set_user_clubs(uuid, uuid[]) from public, anon;

grant execute on function public.can_view_collection(uuid) to anon, authenticated;
grant execute on function public.can_view_shelf(uuid) to anon, authenticated;
grant execute on function public.can_view_media_item(uuid) to anon, authenticated;
grant execute on function public.can_view_interest(uuid, uuid) to anon, authenticated;
grant execute on function public.admin_list_clubs() to authenticated;
grant execute on function public.admin_create_club(text) to authenticated;
grant execute on function public.admin_rename_club(uuid, text) to authenticated;
grant execute on function public.admin_delete_club(uuid) to authenticated;
grant execute on function public.admin_set_user_clubs(uuid, uuid[]) to authenticated;
grant select on public.public_profiles to anon, authenticated;

notify pgrst, 'reload schema';
