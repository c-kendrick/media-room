-- Allow anonymous public section loads without granting anon direct access to
-- private reaction rows. Authenticated calls still read reactions through RLS.
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
    select s.id, s.section, s.name, s.subtitle, s.is_queue_list,
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

  if payload is null or auth.uid() is null then
    return payload;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', r.user_id, 'kind', r.kind, 'work_key', r.work_key
  )), '[]'::jsonb)
  into reaction_rows
  from public.media_reactions r
  where exists (
    select 1
    from public.media_items m
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
