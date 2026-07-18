-- Optional stable public collection URLs. Closed remains the secure default.

alter table public.profiles
  add column if not exists public_collection_enabled boolean not null default false;

create or replace function public.get_public_collection_status()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('username', p.username, 'enabled', p.public_collection_enabled)
  from public.profiles p
  where p.id=auth.uid() and public.profile_is_active(p.id);
$$;

create or replace function public.set_public_collection_enabled(public_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.profile_is_active(auth.uid()) then raise exception 'Approved active account required'; end if;
  update public.profiles set public_collection_enabled=public_enabled where id=auth.uid()
    returning jsonb_build_object('username',username,'enabled',public_collection_enabled) into result;
  return result;
end $$;

-- This anonymous read returns the same sanitized, read-only shape as a secure
-- token link. It never returns profiles, Clubs, interests, or deleted records.
create or replace function public.get_public_collection_by_username(public_username text)
returns jsonb language sql stable security definer set search_path=public as $$
  with target as (
    select c.* from public.profiles p
    join public.collections c on c.owner_id=p.id
    where lower(p.username)=lower(trim(public_username))
      and p.public_collection_enabled
      and p.approved_at is not null
      and p.rejected_at is null
      and p.deactivated_at is null
    order by c.created_at
    limit 1
  )
  select jsonb_build_object(
    'collection', jsonb_build_object(
      'id', c.id,
      'title', c.title,
      'description', c.description,
      'book_description', c.book_description,
      'game_description', c.game_description,
      'updated_at', c.updated_at
    ),
    'shelves', coalesce((
      select jsonb_agg(to_jsonb(shelf_row) order by shelf_row.section, shelf_row.position, shelf_row.id)
      from (
        select s.id, s.section, s.name, s.subtitle, s.is_queue_list, s.position,
          s.is_required, s.show_in_main_watchlist, s.main_watchlist_position
        from public.shelves s
        where s.collection_id=c.id and s.deleted_at is null
      ) shelf_row
    ), '[]'::jsonb),
    'media', coalesce((
      select jsonb_agg(to_jsonb(media_row) order by media_row.created_at, media_row.id)
      from (
        select m.id, m.legacy_id, m.collection_id, m.type, m.title, m.year, m.status,
          m.priority, m.notes, m.poster_url, m.creator, m.director, m.description,
          m.format, m.platforms, m.genres, m.rating, m.star_rating, m.owned,
          m.runtime, m.external_ids, m.created_at, m.updated_at
        from public.media_items m
        where m.collection_id=c.id and m.deleted_at is null
      ) media_row
    ), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(to_jsonb(membership_row) order by membership_row.position, membership_row.shelf_id, membership_row.media_item_id)
      from (
        select sm.shelf_id, sm.media_item_id, sm.position
        from public.shelf_media_items sm
        join public.shelves s on s.id=sm.shelf_id and s.collection_id=c.id and s.deleted_at is null
        join public.media_items m on m.id=sm.media_item_id and m.collection_id=c.id and m.deleted_at is null
      ) membership_row
    ), '[]'::jsonb)
  ) from target c;
$$;

revoke all on function public.get_public_collection_status() from public, anon;
revoke all on function public.set_public_collection_enabled(boolean) from public, anon;
revoke all on function public.get_public_collection_by_username(text) from public;
grant execute on function public.get_public_collection_status(), public.set_public_collection_enabled(boolean) to authenticated;
grant execute on function public.get_public_collection_by_username(text) to anon, authenticated;
notify pgrst, 'reload schema';
