-- Restore the permanent custom-library deletion RPC for deployments where the
-- original migration was skipped. The client calls this function from the Bin.

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

  delete from public.media_items as item where item.library_id = target.id;
  delete from public.shelves as shelf where shelf.library_id = target.id;
  delete from public.libraries as library where library.id = target.id;

  if not found then
    raise exception 'Library could not be permanently deleted';
  end if;

  return query select target.id, target.name, affected_shelves, affected_items;
end;
$$;

revoke all on function public.permanently_delete_library(uuid) from public, anon;
grant execute on function public.permanently_delete_library(uuid) to authenticated;

notify pgrst, 'reload schema';
