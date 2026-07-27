-- Permanently remove a soft-deleted custom library and everything nested
-- beneath it in one ownership-checked transaction.

create or replace function public.permanently_delete_library(target_library_id uuid)
returns table (
  library_id uuid,
  library_name text,
  shelf_count bigint,
  item_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.libraries%rowtype;
  affected_shelves bigint;
  affected_items bigint;
begin
  select * into target
  from public.libraries
  where id = target_library_id
  for update;

  if not found then
    raise exception 'Library not found';
  end if;
  if not public.can_manage_collection(target.collection_id) then
    raise exception 'Library owner access required';
  end if;
  if target.is_protected then
    raise exception 'Default libraries cannot be permanently deleted';
  end if;
  if target.deleted_at is null then
    raise exception 'Only libraries in the Bin can be permanently deleted';
  end if;

  select count(*) into affected_shelves
  from public.shelves as shelf
  where shelf.library_id = target.id;

  select count(*) into affected_items
  from public.media_items as item
  where item.library_id = target.id;

  -- These deletes cascade through shelf memberships, interests, requests, and
  -- other records whose foreign keys belong to the nested shelf or media row.
  delete from public.media_items as item where item.library_id = target.id;
  delete from public.shelves as shelf where shelf.library_id = target.id;
  delete from public.libraries as library where library.id = target.id;

  return query select target.id, target.name, affected_shelves, affected_items;
end;
$$;

revoke all on function public.permanently_delete_library(uuid) from public, anon;
grant execute on function public.permanently_delete_library(uuid) to authenticated;

notify pgrst, 'reload schema';
