-- Reversible member/library deactivation and public-read hardening.

alter table public.profiles
  add column if not exists deactivated_at timestamptz;

alter table public.profiles
  add column if not exists deactivated_by uuid references public.profiles(id) on delete set null;

create or replace function public.is_approved_user()
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and approved_at is not null
      and rejected_at is null
      and deactivated_at is null
  );
$$;

create or replace function public.collection_is_public(target_collection_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1
    from public.collections c
    join public.profiles p on p.id = c.owner_id
    where c.id = target_collection_id
      and p.approved_at is not null
      and p.rejected_at is null
      and p.deactivated_at is null
  );
$$;

create or replace view public.public_profiles
with (security_invoker = false)
as
  select id, username, display_name
  from public.profiles
  where approved_at is not null
    and rejected_at is null
    and deactivated_at is null;

drop policy if exists "Public can read collections" on public.collections;
drop policy if exists "Public can read approved collections" on public.collections;
create policy "Public can read active collections" on public.collections for select
using (public.collection_is_public(id) or public.can_manage_collection(id));

drop policy if exists "Public can read shelves" on public.shelves;
drop policy if exists "Public can read active shelves" on public.shelves;
create policy "Public can read active collection shelves" on public.shelves for select
using ((deleted_at is null and public.collection_is_public(collection_id)) or public.can_manage_collection(collection_id));

drop policy if exists "Public can read media items" on public.media_items;
drop policy if exists "Public can read active media" on public.media_items;
create policy "Public can read active collection media" on public.media_items for select
using ((deleted_at is null and public.collection_is_public(collection_id)) or public.can_manage_collection(collection_id));

drop policy if exists "Public can read shelf membership" on public.shelf_media_items;
create policy "Public can read active collection membership" on public.shelf_media_items for select
using (exists (
  select 1 from public.shelves s
  where s.id = shelf_id
    and ((s.deleted_at is null and public.collection_is_public(s.collection_id)) or public.can_manage_collection(s.collection_id))
));

drop policy if exists "Public can read interest markers" on public.media_interest;
create policy "Public can read active collection interest" on public.media_interest for select
using (exists (
  select 1 from public.media_items m
  where m.id = media_item_id
    and ((m.deleted_at is null and public.collection_is_public(m.collection_id)) or public.can_manage_collection(m.collection_id))
));

create or replace function public.deactivate_profile(target_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if exists (select 1 from public.profiles where id=target_profile_id and role='admin') then raise exception 'Administrator accounts cannot be deactivated'; end if;
  if not exists (select 1 from public.profiles where id=target_profile_id and approved_at is not null and rejected_at is null) then raise exception 'Only an approved member can be deactivated'; end if;
  update public.profiles
  set deactivated_at=coalesce(deactivated_at, now()), deactivated_by=auth.uid()
  where id=target_profile_id;
end $$;

create or replace function public.restore_profile(target_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.profiles
  set deactivated_at=null, deactivated_by=null
  where id=target_profile_id and approved_at is not null and rejected_at is null;
end $$;

revoke all on function public.collection_is_public(uuid) from public;
revoke all on function public.deactivate_profile(uuid) from public;
revoke all on function public.restore_profile(uuid) from public;
grant execute on function public.collection_is_public(uuid) to anon, authenticated;
grant execute on function public.deactivate_profile(uuid) to authenticated;
grant execute on function public.restore_profile(uuid) to authenticated;
grant select on public.public_profiles to anon, authenticated;
