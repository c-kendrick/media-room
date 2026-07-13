-- Atomic, owner-only imports constrained to one media section and shelf.

create or replace function public.bulk_import_media(
  target_collection_id uuid,
  target_shelf_id uuid,
  target_section public.media_section,
  import_items jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  entry jsonb;
  item_title text;
  item_type public.media_type;
  item_year integer;
  created_id uuid;
  next_position numeric(12, 6);
  imported_count integer := 0;
  skipped_count integer := 0;
begin
  if jsonb_typeof(import_items) <> 'array' or jsonb_array_length(import_items) = 0 then
    raise exception 'Import must contain at least one item';
  end if;
  if jsonb_array_length(import_items) > 250 then
    raise exception 'A single import is limited to 250 items';
  end if;
  if not exists (
    select 1 from public.collections c
    join public.profiles p on p.id = c.owner_id
    where c.id = target_collection_id
      and c.owner_id = auth.uid()
      and p.approved_at is not null
      and p.deactivated_at is null
  ) then raise exception 'Only the active collection owner can import media'; end if;
  if not exists (
    select 1 from public.shelves s
    where s.id = target_shelf_id
      and s.collection_id = target_collection_id
      and s.section = target_section
      and s.deleted_at is null
  ) then raise exception 'Destination shelf does not belong to this collection section'; end if;

  select coalesce(max(position), 0) into next_position
  from public.shelf_media_items where shelf_id = target_shelf_id;

  for entry in select value from jsonb_array_elements(import_items)
  loop
    item_title := trim(entry->>'title');
    begin
      item_type := (entry->>'type')::public.media_type;
    exception when others then
      raise exception 'Invalid media type in import';
    end;
    if nullif(entry->>'year', '') is null then
      item_year := null;
    else
      begin
        item_year := (entry->>'year')::integer;
      exception when others then
        raise exception 'Invalid year in import';
      end;
    end if;

    if item_title is null or item_title = '' then raise exception 'Every imported item needs a title'; end if;
    if item_year is not null and (item_year < 1000 or item_year > 3000) then raise exception 'Year must be between 1000 and 3000'; end if;
    if (target_section = 'screen' and item_type not in ('film', 'television'))
      or (target_section = 'book' and item_type <> 'book')
      or (target_section = 'game' and item_type <> 'game') then
      raise exception 'Import contains a media type outside the current section';
    end if;

    if exists (
      select 1 from public.media_items m
      where m.collection_id = target_collection_id
        and lower(trim(m.title)) = lower(item_title)
        and m.year is not distinct from item_year
        and m.deleted_at is null
    ) then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    insert into public.media_items (collection_id, type, title, year, platforms, genres)
    values (target_collection_id, item_type, item_title, item_year, '{}', '{}')
    returning id into created_id;
    next_position := next_position + 1000;
    insert into public.shelf_media_items (shelf_id, media_item_id, position)
    values (target_shelf_id, created_id, next_position);
    imported_count := imported_count + 1;
  end loop;

  return jsonb_build_object('imported', imported_count, 'skipped', skipped_count);
end $$;

revoke all on function public.bulk_import_media(uuid, uuid, public.media_section, jsonb) from public;
grant execute on function public.bulk_import_media(uuid, uuid, public.media_section, jsonb) to authenticated;
