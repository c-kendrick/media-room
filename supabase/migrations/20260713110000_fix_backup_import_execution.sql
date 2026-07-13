-- Harden backup restore after the original function's first live execution.
-- The inner exception block is transactional: any error rolls the whole merge
-- back, then returns the actual database message to the browser.
create or replace function public.import_collection_backup(
  target_collection_id uuid,
  backup jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entry jsonb;
  shelf_entry jsonb;
  shelf_key text;
  shelf_section public.media_section;
  restored_shelf_id uuid;
  shelf_map jsonb := '{}'::jsonb;
  item_key text;
  item_type public.media_type;
  backup_database_id uuid;
  restored_media_id uuid;
  membership_key text;
  membership_position numeric(12, 6);
  shelf_count integer := 0;
  media_count integer := 0;
  membership_count integer := 0;
begin
  begin
    if backup->>'format' is distinct from 'media-room/v1'
      or jsonb_typeof(backup->'shelves') is distinct from 'array'
      or jsonb_typeof(backup->'media') is distinct from 'array'
    then raise exception 'Invalid Media Room backup'; end if;

    if jsonb_array_length(backup->'shelves') > 500
      or jsonb_array_length(backup->'media') > 10000
    then raise exception 'Backup exceeds the safe import limit'; end if;

    if not exists (
      select 1 from public.collections c
      join public.profiles p on p.id = c.owner_id
      where c.id = target_collection_id
        and c.owner_id = auth.uid()
        and p.approved_at is not null
        and p.rejected_at is null
        and p.deactivated_at is null
    ) then raise exception 'Only the active collection owner can import a backup'; end if;

    if jsonb_typeof(backup#>'{collection,descriptions}') = 'object' then
      update public.collections
      set description = coalesce(backup#>>'{collection,descriptions,screen}', description),
          book_description = coalesce(backup#>>'{collection,descriptions,book}', book_description),
          game_description = coalesce(backup#>>'{collection,descriptions,game}', game_description)
      where id = target_collection_id;
    end if;

    for shelf_entry in select value from jsonb_array_elements(backup->'shelves')
    loop
      shelf_key := trim(shelf_entry->>'shelf_id');
      if shelf_key is null or shelf_key = '' or trim(coalesce(shelf_entry->>'name', '')) = '' then
        raise exception 'Backup contains an invalid shelf';
      end if;
      begin
        shelf_section := (shelf_entry->>'section')::public.media_section;
      exception when others then
        raise exception 'Backup contains an invalid shelf section';
      end;

      insert into public.shelves as current_shelf (
        collection_id, section, name, position, deleted_at,
        is_required, show_in_main_watchlist, main_watchlist_position
      ) values (
        target_collection_id,
        shelf_section,
        trim(shelf_entry->>'name'),
        coalesce((shelf_entry->>'position')::numeric, 1000),
        case when coalesce((shelf_entry->>'required')::boolean, false) then null else (shelf_entry->>'deleted_at')::timestamptz end,
        coalesce((shelf_entry->>'required')::boolean, false),
        shelf_section = 'screen' and coalesce((shelf_entry->>'showInMainWatchlist')::boolean, false),
        (shelf_entry->>'mainWatchlistPosition')::numeric
      )
      on conflict (collection_id, section, name) do update set
        position = excluded.position,
        deleted_at = case when current_shelf.is_required or excluded.is_required then null else excluded.deleted_at end,
        is_required = current_shelf.is_required or excluded.is_required,
        show_in_main_watchlist = case when shelf_entry ? 'showInMainWatchlist' then excluded.show_in_main_watchlist else current_shelf.show_in_main_watchlist end,
        main_watchlist_position = case when shelf_entry ? 'mainWatchlistPosition' then excluded.main_watchlist_position else current_shelf.main_watchlist_position end
      returning id into restored_shelf_id;

      shelf_map := shelf_map || jsonb_build_object(shelf_key, restored_shelf_id::text);
      shelf_count := shelf_count + 1;
    end loop;

    for entry in select value from jsonb_array_elements(backup->'media')
    loop
      item_key := trim(coalesce(entry->>'item_id', entry->>'database_id'));
      if item_key is null or item_key = '' or trim(coalesce(entry->>'title', '')) = '' then
        raise exception 'Backup contains an invalid media item';
      end if;
      begin
        item_type := (entry->>'type')::public.media_type;
      exception when others then
        raise exception 'Backup contains an invalid media type';
      end;

      backup_database_id := null;
      begin
        backup_database_id := nullif(entry->>'database_id', '')::uuid;
      exception when others then
        backup_database_id := null;
      end;

      if backup_database_id is not null then
        update public.media_items
        set legacy_id = coalesce(legacy_id, item_key)
        where id = backup_database_id and collection_id = target_collection_id;
      end if;

      insert into public.media_items as current_media (
        collection_id, legacy_id, type, title, year, status, priority, notes,
        poster_url, creator, director, description, format, platforms, genres,
        rating, star_rating, owned, runtime, external_ids, deleted_at
      ) values (
        target_collection_id,
        item_key,
        item_type,
        trim(entry->>'title'),
        (entry->>'year')::smallint,
        entry->>'status',
        entry->>'priority',
        entry->>'notes',
        entry->>'poster_url',
        entry->>'creator',
        entry->>'director',
        entry->>'description',
        entry->>'format',
        case when jsonb_typeof(entry->'platforms') = 'array' then array(select jsonb_array_elements_text(entry->'platforms')) else '{}'::text[] end,
        case when jsonb_typeof(entry->'genres') = 'array' then array(select jsonb_array_elements_text(entry->'genres')) else '{}'::text[] end,
        (entry->>'rating')::numeric,
        (entry->>'star_rating')::numeric,
        coalesce((entry->>'owned')::boolean, false),
        (entry->>'runtime')::integer,
        case when jsonb_typeof(entry->'external_ids') = 'object' then entry->'external_ids' else '{}'::jsonb end,
        (entry->>'deleted_at')::timestamptz
      )
      on conflict (collection_id, legacy_id) do update set
        type = excluded.type,
        title = excluded.title,
        year = excluded.year,
        status = excluded.status,
        priority = excluded.priority,
        notes = excluded.notes,
        poster_url = excluded.poster_url,
        creator = excluded.creator,
        director = excluded.director,
        description = excluded.description,
        format = excluded.format,
        platforms = excluded.platforms,
        genres = excluded.genres,
        rating = excluded.rating,
        star_rating = case when entry ? 'star_rating' then excluded.star_rating else current_media.star_rating end,
        owned = case when entry ? 'owned' then excluded.owned else current_media.owned end,
        runtime = excluded.runtime,
        deleted_at = excluded.deleted_at
      returning id into restored_media_id;

      if jsonb_typeof(entry->'lists') = 'array' then
        for membership_key in select jsonb_array_elements_text(entry->'lists')
        loop
          restored_shelf_id := nullif(shelf_map->>membership_key, '')::uuid;
          if restored_shelf_id is null then continue; end if;
          membership_position := coalesce((entry->'list_positions'->>membership_key)::numeric, 1000);
          insert into public.shelf_media_items (shelf_id, media_item_id, position)
          values (restored_shelf_id, restored_media_id, membership_position)
          on conflict (shelf_id, media_item_id) do update set position = excluded.position;
          membership_count := membership_count + 1;
        end loop;
      end if;

      media_count := media_count + 1;
    end loop;

    return jsonb_build_object(
      'ok', true,
      'shelves', shelf_count,
      'media', media_count,
      'memberships', membership_count
    );
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'code', sqlstate);
  end;
end;
$$;

revoke all on function public.import_collection_backup(uuid, jsonb) from public;
grant execute on function public.import_collection_backup(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
