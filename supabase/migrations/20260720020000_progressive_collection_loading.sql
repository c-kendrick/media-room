-- Fetch the active collection section as one compact, RLS-aware payload.
-- Drawer-only fields intentionally remain out of the card projection.

create index if not exists media_items_collection_type_created_idx
  on public.media_items (collection_id, type, created_at);

create index if not exists shelf_media_items_media_item_idx
  on public.shelf_media_items (media_item_id, shelf_id);

create or replace function public.load_collection_section(
  target_collection_id uuid,
  target_section public.media_section
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with visible_collection as materialized (
    select c.*
    from public.collections c
    where c.id = target_collection_id
    limit 1
  ),
  section_shelves as materialized (
    select s.id, s.section, s.name, s.subtitle, s.is_queue_list,
      s.position, s.deleted_at, s.is_required, s.show_in_main_watchlist,
      s.main_watchlist_position
    from public.shelves s
    join visible_collection c on c.id = s.collection_id
    where s.section = target_section
  ),
  section_media as materialized (
    select m.id, m.legacy_id, m.collection_id, m.type, m.title, m.year,
      m.status, m.priority, m.poster_url, m.creator, m.format, m.platforms, m.rating,
      m.star_rating, m.owned, m.deleted_at, m.created_at, m.updated_at
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
  ),
  section_reactions as materialized (
    select r.user_id, r.kind, r.work_key
    from public.media_reactions r
    where exists (
      select 1 from section_media m
      where r.work_key = public.media_reaction_work_key(m.type::text, m.title, m.year::integer)
    )
  ),
  relevant_profiles as (
    select user_id from section_interests
    union
    select user_id from section_reactions
  )
  select case when not exists (select 1 from visible_collection) then null else jsonb_build_object(
    'collection', (select to_jsonb(c) from visible_collection c),
    'shelves', coalesce((select jsonb_agg(to_jsonb(s) order by s.position, s.id) from section_shelves s), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at, m.id) from section_media m), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(to_jsonb(sm) order by sm.position, sm.media_item_id) from section_memberships sm), '[]'::jsonb),
    'interests', coalesce((select jsonb_agg(to_jsonb(i)) from section_interests i), '[]'::jsonb),
    'reactions', coalesce((select jsonb_agg(to_jsonb(r)) from section_reactions r), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name))
      from public.public_profiles p
      join relevant_profiles rp on rp.user_id = p.id
    ), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.load_collection_section(uuid, public.media_section) from public;
grant execute on function public.load_collection_section(uuid, public.media_section) to anon, authenticated;
