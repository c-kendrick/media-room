-- Revocable collection share links are deliberately separate from Club visibility.
-- No existing collection, membership, interest, can_view_collection, or RLS policy is changed.

create table public.collection_share_links (
  collection_id uuid primary key references public.collections(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collection_share_links_token_format check (token ~ '^[0-9a-f]{64}$')
);

create trigger collection_share_links_set_updated_at
before update on public.collection_share_links
for each row execute function public.set_updated_at();

alter table public.collection_share_links enable row level security;
revoke all on public.collection_share_links from public, anon, authenticated;

create or replace function public.owns_active_collection(target_collection_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1
    from public.collections c
    join public.profiles p on p.id = c.owner_id
    where c.id = target_collection_id
      and c.owner_id = auth.uid()
      and p.approved_at is not null
      and p.rejected_at is null
      and p.deactivated_at is null
  );
$$;

create or replace function public.get_collection_share(target_collection_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare link public.collection_share_links;
begin
  if not public.owns_active_collection(target_collection_id) then
    raise exception 'Collection owner access required';
  end if;
  select * into link from public.collection_share_links where collection_id = target_collection_id;
  if not found then return null; end if;
  return jsonb_build_object('token', link.token, 'enabled', link.enabled, 'updated_at', link.updated_at);
end $$;

create or replace function public.create_collection_share(target_collection_id uuid, rotate_token boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.collection_share_links;
begin
  if not public.owns_active_collection(target_collection_id) then
    raise exception 'Collection owner access required';
  end if;

  insert into public.collection_share_links (collection_id)
  values (target_collection_id)
  on conflict (collection_id) do update
    set token = case when rotate_token then encode(gen_random_bytes(32), 'hex') else collection_share_links.token end,
        enabled = true,
        updated_at = now()
  returning * into link;

  return jsonb_build_object('token', link.token, 'enabled', link.enabled, 'updated_at', link.updated_at);
end $$;

create or replace function public.set_collection_share_enabled(target_collection_id uuid, share_enabled boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.collection_share_links;
begin
  if not public.owns_active_collection(target_collection_id) then
    raise exception 'Collection owner access required';
  end if;
  update public.collection_share_links
  set enabled = share_enabled
  where collection_id = target_collection_id
  returning * into link;
  if not found then raise exception 'Share link not found'; end if;
  return jsonb_build_object('token', link.token, 'enabled', link.enabled, 'updated_at', link.updated_at);
end $$;

create or replace function public.delete_collection_share(target_collection_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.owns_active_collection(target_collection_id) then
    raise exception 'Collection owner access required';
  end if;
  delete from public.collection_share_links where collection_id = target_collection_id;
end $$;

-- This is the only anonymous path to shared data. It returns one sanitized snapshot,
-- excludes profiles and interest markers, and cannot be used to discover collections.
create or replace function public.get_shared_collection(share_token text)
returns jsonb language sql stable security definer set search_path=public as $$
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
        where s.collection_id = c.id and s.deleted_at is null
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
        where m.collection_id = c.id and m.deleted_at is null
      ) media_row
    ), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(to_jsonb(membership_row) order by membership_row.position, membership_row.shelf_id, membership_row.media_item_id)
      from (
        select sm.shelf_id, sm.media_item_id, sm.position
        from public.shelf_media_items sm
        join public.shelves s on s.id = sm.shelf_id and s.collection_id = c.id and s.deleted_at is null
        join public.media_items m on m.id = sm.media_item_id and m.collection_id = c.id and m.deleted_at is null
      ) membership_row
    ), '[]'::jsonb)
  )
  from public.collection_share_links link
  join public.collections c on c.id = link.collection_id
  join public.profiles p on p.id = c.owner_id
  where link.token = share_token
    and link.enabled
    and p.approved_at is not null
    and p.rejected_at is null
    and p.deactivated_at is null;
$$;

revoke all on function public.owns_active_collection(uuid) from public, anon, authenticated;
revoke all on function public.get_collection_share(uuid) from public, anon;
revoke all on function public.create_collection_share(uuid, boolean) from public, anon;
revoke all on function public.set_collection_share_enabled(uuid, boolean) from public, anon;
revoke all on function public.delete_collection_share(uuid) from public, anon;
revoke all on function public.get_shared_collection(text) from public;

grant execute on function public.get_collection_share(uuid) to authenticated;
grant execute on function public.create_collection_share(uuid, boolean) to authenticated;
grant execute on function public.set_collection_share_enabled(uuid, boolean) to authenticated;
grant execute on function public.delete_collection_share(uuid) to authenticated;
grant execute on function public.get_shared_collection(text) to anon, authenticated;

notify pgrst, 'reload schema';
