-- A section snapshot can legitimately omit an active membership that is not
-- renderable in that section (for example, legacy cross-section data). Keep
-- those server-only memberships after the submitted visible order instead of
-- rejecting an otherwise complete Arrange Shelf draft.
create or replace function public.reorder_shelf_media(target_shelf_id uuid, ordered_media_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
declare
  requested_count integer := coalesce(array_length(ordered_media_ids, 1), 0);
begin
  if not exists (
    select 1 from public.shelves
    where id = target_shelf_id and public.can_manage_collection(collection_id)
  ) then raise exception 'Collection access required'; end if;

  if exists (select 1 from unnest(ordered_media_ids) id group by id having count(*) > 1) then
    raise exception 'Duplicate membership identity';
  end if;

  if exists (
    select 1 from unnest(ordered_media_ids) id
    where not exists (
      select 1 from public.shelf_media_items smi
      join public.media_items m on m.id = smi.media_item_id and m.deleted_at is null
      where smi.shelf_id = target_shelf_id and smi.media_item_id = id
    )
  ) then raise exception 'Media item is not active on this shelf'; end if;

  with requested as (
    select id as media_item_id, ordinality::bigint as next_rank
    from unnest(ordered_media_ids) with ordinality u(id, ordinality)
  ), preserved as (
    select smi.media_item_id,
      requested_count + row_number() over (
        order by (m.deleted_at is not null), smi.position, smi.created_at, smi.media_item_id
      ) as next_rank
    from public.shelf_media_items smi
    join public.media_items m on m.id = smi.media_item_id
    where smi.shelf_id = target_shelf_id
      and not (smi.media_item_id = any(coalesce(ordered_media_ids, array[]::uuid[])))
  ), next_positions as (
    select * from requested
    union all
    select * from preserved
  )
  update public.shelf_media_items smi
  set position = next_positions.next_rank * 1000
  from next_positions
  where smi.shelf_id = target_shelf_id
    and smi.media_item_id = next_positions.media_item_id;
end $$;

revoke all on function public.reorder_shelf_media(uuid, uuid[]) from public;
grant execute on function public.reorder_shelf_media(uuid, uuid[]) to authenticated;
