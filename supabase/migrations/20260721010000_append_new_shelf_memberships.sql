-- Add new shelf memberships at the end of each shelf. Locking the selected
-- shelf rows makes concurrent additions serialize without sharing a position.
create or replace function public.append_media_shelf_memberships(
  target_media_item_id uuid,
  target_shelf_ids uuid[]
)
returns void language plpgsql security definer set search_path=public as $$
declare
  media_row public.media_items%rowtype;
begin
  if coalesce(cardinality(target_shelf_ids), 0) = 0 then return; end if;
  if cardinality(target_shelf_ids) <> (select count(distinct shelf_id) from unnest(target_shelf_ids) selected(shelf_id)) then
    raise exception 'A shelf can only be selected once';
  end if;

  select * into media_row
  from public.media_items
  where id = target_media_item_id and deleted_at is null;

  if media_row.id is null or not public.can_manage_collection(media_row.collection_id) then
    raise exception 'Collection access required';
  end if;

  if exists (
    select 1 from unnest(target_shelf_ids) selected(shelf_id)
    where not exists (
      select 1 from public.shelves s
      where s.id = selected.shelf_id
        and s.collection_id = media_row.collection_id
        and s.deleted_at is null
        and ((s.section = 'screen' and media_row.type in ('film', 'television'))
          or (s.section = 'book' and media_row.type = 'book')
          or (s.section = 'game' and media_row.type = 'game'))
    )
  ) then raise exception 'Every selected shelf must belong to the media collection and section'; end if;

  perform s.id
  from public.shelves s
  where s.id = any(target_shelf_ids)
  order by s.id
  for update;

  insert into public.shelf_media_items (shelf_id, media_item_id, position)
  select s.id, target_media_item_id, coalesce(max(existing.position), 0) + 1000
  from public.shelves s
  left join public.shelf_media_items existing on existing.shelf_id = s.id
  where s.id = any(target_shelf_ids)
  group by s.id
  on conflict (shelf_id, media_item_id) do nothing;
end $$;

revoke all on function public.append_media_shelf_memberships(uuid, uuid[]) from public;
grant execute on function public.append_media_shelf_memberships(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
