-- Fixed seven-item shelf sets and shelf-specific ranking labels.
--
-- Existing visible order is preserved by reproducing the old renderer: split
-- the dense order at its midpoint, take seven from the top lane, seven from the
-- bottom lane, then repeat. Soft-deleted memberships are kept, in stable order,
-- after active entries so they cannot create visible numbering gaps.

alter table public.shelves
  add column if not exists is_numbered boolean not null default false,
  add column if not exists seven_set_migrated_at timestamptz;

with active_source as (
  select smi.shelf_id, smi.media_item_id,
    row_number() over (partition by smi.shelf_id order by smi.position, smi.created_at, smi.media_item_id) as old_rank,
    count(*) over (partition by smi.shelf_id) as item_count
  from public.shelf_media_items smi
  join public.media_items m on m.id = smi.media_item_id and m.deleted_at is null
  join public.shelves s on s.id = smi.shelf_id and s.seven_set_migrated_at is null
), visual_keys as (
  select *, ceil(item_count / 2.0)::integer as midpoint,
    case when old_rank <= ceil(item_count / 2.0)
      then floor((old_rank - 1) / 7.0)::integer
      else floor((old_rank - ceil(item_count / 2.0) - 1) / 7.0)::integer
    end as segment_index,
    case when old_rank <= ceil(item_count / 2.0) then 0 else 1 end as lane_index,
    case when old_rank <= ceil(item_count / 2.0)
      then mod((old_rank - 1)::integer, 7)
      else mod((old_rank - ceil(item_count / 2.0) - 1)::integer, 7)
    end as lane_offset
  from active_source
), active_ranks as (
  select shelf_id, media_item_id,
    row_number() over (partition by shelf_id order by segment_index, lane_index, lane_offset, old_rank) as new_rank
  from visual_keys
), hidden_ranks as (
  select smi.shelf_id, smi.media_item_id,
    coalesce(active_counts.item_count, 0) + row_number() over (
      partition by smi.shelf_id order by smi.position, smi.created_at, smi.media_item_id
    ) as new_rank
  from public.shelf_media_items smi
  join public.media_items m on m.id = smi.media_item_id and m.deleted_at is not null
  join public.shelves s on s.id = smi.shelf_id and s.seven_set_migrated_at is null
  left join (select shelf_id, count(*) as item_count from active_source group by shelf_id) active_counts
    on active_counts.shelf_id = smi.shelf_id
), all_ranks as (
  select * from active_ranks
  union all
  select * from hidden_ranks
)
update public.shelf_media_items smi
set position = all_ranks.new_rank * 1000
from all_ranks
where smi.shelf_id = all_ranks.shelf_id
  and smi.media_item_id = all_ranks.media_item_id;

update public.shelves
set seven_set_migrated_at = now()
where seven_set_migrated_at is null;

alter table public.shelves
  alter column seven_set_migrated_at set default now(),
  alter column seven_set_migrated_at set not null;

-- One ownership-checked statement updates active and hidden memberships. This
-- is atomic and cannot leave a shelf partially reordered.
create or replace function public.reorder_shelf_media(target_shelf_id uuid, ordered_media_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
declare
  active_count integer;
begin
  if not exists (
    select 1 from public.shelves
    where id = target_shelf_id and public.can_manage_collection(collection_id)
  ) then raise exception 'Collection access required'; end if;

  if exists (select 1 from unnest(ordered_media_ids) id group by id having count(*) > 1) then
    raise exception 'Duplicate membership identity';
  end if;

  select count(*) into active_count
  from public.shelf_media_items smi
  join public.media_items m on m.id = smi.media_item_id and m.deleted_at is null
  where smi.shelf_id = target_shelf_id;

  if active_count <> coalesce(array_length(ordered_media_ids, 1), 0) then
    raise exception 'Order must include every active shelf item';
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
  ), hidden as (
    select smi.media_item_id,
      active_count + row_number() over (order by smi.position, smi.created_at, smi.media_item_id) as next_rank
    from public.shelf_media_items smi
    join public.media_items m on m.id = smi.media_item_id and m.deleted_at is not null
    where smi.shelf_id = target_shelf_id
  ), next_positions as (
    select * from requested
    union all
    select * from hidden
  )
  update public.shelf_media_items smi
  set position = next_positions.next_rank * 1000
  from next_positions
  where smi.shelf_id = target_shelf_id
    and smi.media_item_id = next_positions.media_item_id;
end $$;

revoke all on function public.reorder_shelf_media(uuid, uuid[]) from public;
grant execute on function public.reorder_shelf_media(uuid, uuid[]) to authenticated;

-- Keep the compact section loader in sync with the new shelf property.
create or replace function public.load_collection_section(
  target_collection_id uuid,
  target_section public.media_section
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  payload jsonb;
  reaction_rows jsonb := '[]'::jsonb;
  reaction_profiles jsonb := '[]'::jsonb;
begin
  with visible_collection as materialized (
    select c.* from public.collections c where c.id = target_collection_id limit 1
  ),
  section_shelves as materialized (
    select s.id, s.section, s.name, s.subtitle, s.is_queue_list, s.is_numbered,
      s.position, s.deleted_at, s.is_required, s.show_in_main_watchlist,
      s.main_watchlist_position
    from public.shelves s
    join visible_collection c on c.id = s.collection_id
    where s.section = target_section
  ),
  section_media as materialized (
    select m.id, m.legacy_id, m.collection_id, m.type, m.title, m.year,
      m.status, m.priority, m.poster_url, m.creator, m.format, m.platforms,
      m.rating, m.star_rating, m.owned, m.deleted_at, m.created_at, m.updated_at
    from public.media_items m
    join visible_collection c on c.id = m.collection_id
    where case target_section
      when 'screen' then m.type in ('film', 'television')
      when 'book' then m.type = 'book'
      when 'game' then m.type = 'game'
    end
  ),
  section_memberships as materialized (
    select smi.shelf_id, smi.media_item_id, smi.position
    from public.shelf_media_items smi
    join section_shelves s on s.id = smi.shelf_id
    join section_media m on m.id = smi.media_item_id
  ),
  section_interests as materialized (
    select i.media_item_id, i.user_id
    from public.media_interest i
    join section_media m on m.id = i.media_item_id
  )
  select case when not exists (select 1 from visible_collection) then null else jsonb_build_object(
    'collection', (select to_jsonb(c) from visible_collection c),
    'shelves', coalesce((select jsonb_agg(to_jsonb(s) order by s.position, s.id) from section_shelves s), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at, m.id) from section_media m), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(to_jsonb(sm) order by sm.position, sm.media_item_id) from section_memberships sm), '[]'::jsonb),
    'interests', coalesce((select jsonb_agg(to_jsonb(i)) from section_interests i), '[]'::jsonb),
    'reactions', '[]'::jsonb,
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name))
      from public.public_profiles p
      where exists (select 1 from section_interests i where i.user_id = p.id)
    ), '[]'::jsonb)
  ) end into payload;

  if payload is null or auth.uid() is null then return payload; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', r.user_id, 'kind', r.kind, 'work_key', r.work_key
  )), '[]'::jsonb)
  into reaction_rows
  from public.media_reactions r
  where exists (
    select 1 from public.media_items m
    where m.collection_id = target_collection_id
      and case target_section
        when 'screen' then m.type in ('film', 'television')
        when 'book' then m.type = 'book'
        when 'game' then m.type = 'game'
      end
      and r.work_key = public.media_reaction_work_key(m.type::text, m.title, m.year::integer)
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name
  )), '[]'::jsonb)
  into reaction_profiles
  from public.public_profiles p
  where exists (
    select 1 from jsonb_array_elements(reaction_rows) reaction
    where reaction->>'user_id' = p.id::text
  );

  return payload || jsonb_build_object(
    'reactions', reaction_rows,
    'profiles', coalesce(payload->'profiles', '[]'::jsonb) || reaction_profiles
  );
end;
$$;

revoke all on function public.load_collection_section(uuid, public.media_section) from public;
grant execute on function public.load_collection_section(uuid, public.media_section) to anon, authenticated;
