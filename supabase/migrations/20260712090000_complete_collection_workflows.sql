-- Complete the multi-collection workflow.  This migration is deliberately
-- additive so it can be applied to the imported Kit collection safely.

alter table public.media_items add column if not exists external_ids jsonb not null default '{}'::jsonb;

-- Soft-deleted records remain available to their owner/admin for restore, but
-- never appear in public browsing or public collection navigation.
drop policy if exists "Public can read collections" on public.collections;
create policy "Public can read approved collections" on public.collections for select
using (exists (select 1 from public.profiles p where p.id = owner_id and p.approved_at is not null and p.rejected_at is null));

drop policy if exists "Public can read shelves" on public.shelves;
create policy "Public can read active shelves" on public.shelves for select
using (deleted_at is null or public.can_manage_collection(collection_id));

drop policy if exists "Public can read media items" on public.media_items;
create policy "Public can read active media" on public.media_items for select
using (deleted_at is null or public.can_manage_collection(collection_id));

-- A marker is meaningful only on Film & TV.  The foreign item must be public;
-- the caller can write only their own row.
drop policy if exists "Approved users can add their own interest" on public.media_interest;
create policy "Approved users can add screen interest" on public.media_interest for insert to authenticated
with check (user_id = auth.uid() and public.is_approved_user() and exists (
  select 1 from public.media_items m where m.id = media_item_id and m.type in ('film','television') and m.deleted_at is null
));
drop policy if exists "Users and admins can remove interest" on public.media_interest;
create policy "Users can remove their own interest" on public.media_interest for delete to authenticated
using (user_id = auth.uid() or public.is_admin());

-- Memberships cannot cross sections: a book cannot be placed on a Film & TV
-- shelf, and vice versa.
create or replace function public.valid_shelf_membership()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists (
    select 1 from public.shelves s join public.media_items m on m.id = new.media_item_id
    where s.id = new.shelf_id
      and s.collection_id = m.collection_id
      and ((s.section = 'screen' and m.type in ('film','television'))
        or (s.section = 'book' and m.type = 'book')
        or (s.section = 'game' and m.type = 'game'))
  ) then raise exception 'Media item and shelf must belong to the same collection and section'; end if;
  return new;
end $$;
drop trigger if exists shelf_media_items_validate_section on public.shelf_media_items;
create trigger shelf_media_items_validate_section before insert or update on public.shelf_media_items
for each row execute function public.valid_shelf_membership();

-- Atomic insertion ordering avoids swaps and partial client-side updates.
create or replace function public.reorder_shelf_media(target_shelf_id uuid, ordered_media_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists (select 1 from public.shelves where id=target_shelf_id and public.can_manage_collection(collection_id)) then
    raise exception 'Collection access required';
  end if;
  if exists (select 1 from unnest(ordered_media_ids) id group by id having count(*) > 1) then raise exception 'Duplicate media id'; end if;
  if (select count(*) from public.shelf_media_items where shelf_id=target_shelf_id) <> coalesce(array_length(ordered_media_ids,1),0) then raise exception 'Order must include every shelf item'; end if;
  if exists (select 1 from unnest(ordered_media_ids) id where not exists (select 1 from public.shelf_media_items sm where sm.shelf_id=target_shelf_id and sm.media_item_id=id)) then raise exception 'Media item is not on this shelf'; end if;
  update public.shelf_media_items sm set position = ranked.position
  from (select id, ordinality * 1000 as position from unnest(ordered_media_ids) with ordinality u(id, ordinality)) ranked
  where sm.shelf_id=target_shelf_id and sm.media_item_id=ranked.id;
end $$;

create or replace function public.reorder_shelves(target_collection_id uuid, target_section public.media_section, ordered_shelf_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.can_manage_collection(target_collection_id) then raise exception 'Collection access required'; end if;
  if (select count(*) from public.shelves where collection_id=target_collection_id and section=target_section and deleted_at is null) <> coalesce(array_length(ordered_shelf_ids,1),0) then raise exception 'Order must include every active shelf'; end if;
  if exists (select 1 from unnest(ordered_shelf_ids) id where not exists (select 1 from public.shelves s where s.id=id and s.collection_id=target_collection_id and s.section=target_section and s.deleted_at is null)) then raise exception 'Shelf is outside this section'; end if;
  update public.shelves s set position = ranked.position
  from (select id, ordinality * 1000 as position from unnest(ordered_shelf_ids) with ordinality u(id, ordinality)) ranked
  where s.id=ranked.id;
end $$;
revoke all on function public.reorder_shelf_media(uuid,uuid[]) from public;
revoke all on function public.reorder_shelves(uuid,public.media_section,uuid[]) from public;
grant execute on function public.reorder_shelf_media(uuid,uuid[]) to authenticated;
grant execute on function public.reorder_shelves(uuid,public.media_section,uuid[]) to authenticated;

