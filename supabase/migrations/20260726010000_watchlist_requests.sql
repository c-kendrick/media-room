-- Persistent, ownership-safe requests for Priority Stamp removal and watched-item moves.

alter table public.media_reactions
  add column if not exists state text not null default 'active'
  check (state in ('active', 'removal_requested'));

create table public.watchlist_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('priority_stamp_removal', 'move_watched_item')),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  media_item_id uuid not null references public.media_items(id) on delete cascade,
  club_id uuid references public.clubs(id) on delete cascade,
  source_shelf_id uuid references public.shelves(id) on delete cascade,
  stamp_user_id uuid references public.profiles(id) on delete cascade,
  stamp_work_key text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  final_response text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  check (requester_id <> target_user_id),
  check (
    (request_type = 'priority_stamp_removal'
      and source_shelf_id is null and stamp_user_id = target_user_id and stamp_work_key is not null)
    or
    (request_type = 'move_watched_item'
      and club_id is not null and source_shelf_id is not null and stamp_user_id is null and stamp_work_key is null)
  ),
  check ((status = 'pending' and resolved_at is null and final_response is null)
    or (status <> 'pending' and resolved_at is not null and final_response is not null))
);

create unique index watchlist_requests_pending_stamp_idx
  on public.watchlist_requests(target_user_id, media_item_id, stamp_user_id, stamp_work_key)
  where request_type = 'priority_stamp_removal' and status = 'pending';
create unique index watchlist_requests_pending_move_idx
  on public.watchlist_requests(club_id, target_user_id, media_item_id, source_shelf_id)
  where request_type = 'move_watched_item' and status = 'pending';
create index watchlist_requests_target_pending_idx
  on public.watchlist_requests(target_user_id, status, created_at);
create index watchlist_requests_requester_media_idx
  on public.watchlist_requests(requester_id, media_item_id, created_at);
create trigger watchlist_requests_set_updated_at before update on public.watchlist_requests
for each row execute function public.set_updated_at();

alter table public.watchlist_requests enable row level security;
revoke all on public.watchlist_requests from public, anon, authenticated;
create policy "Request participants can read watchlist requests"
on public.watchlist_requests for select to authenticated
using (requester_id = auth.uid() or target_user_id = auth.uid());
grant select on public.watchlist_requests to authenticated;

drop policy if exists "Signed-in viewers can read visible media reactions" on public.media_reactions;
create policy "Signed-in viewers can read active visible media reactions"
on public.media_reactions for select to authenticated
using (state = 'active' and public.can_view_media_reaction(user_id));

create or replace function public.club_work_is_topmost(target_club_id uuid, target_work_key text)
returns boolean language sql stable security definer set search_path=public as $$
  with interested_people as (
    select r.user_id
    from public.media_reactions r
    join public.club_memberships cm on cm.club_id = target_club_id and cm.user_id = r.user_id
    where r.kind = 'priority' and r.state = 'active' and r.work_key = target_work_key
    union
    select c.owner_id
    from public.shelf_media_items smi
    join public.shelves s on s.id = smi.shelf_id
      and s.show_in_main_watchlist and s.deleted_at is null
    join public.media_items m on m.id = smi.media_item_id and m.deleted_at is null
    join public.collections c on c.id = m.collection_id
    join public.club_memberships cm on cm.club_id = target_club_id and cm.user_id = c.owner_id
    where public.media_reaction_work_key(m.type::text, m.title, m.year::integer) = target_work_key
  )
  select
    exists (
      select 1 from public.media_reactions r
      join public.club_memberships cm on cm.club_id = target_club_id and cm.user_id = r.user_id
      where r.kind = 'priority' and r.state = 'active' and r.work_key = target_work_key
    )
    or (select count(distinct user_id) from interested_people) > 1;
$$;

create or replace function public.request_priority_stamp_removal(
  target_media_item_id uuid,
  target_club_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  target public.media_items;
  target_owner uuid;
  target_key text;
  created_count integer := 0;
  awaiting_count integer := 0;
  cleared_count integer := 0;
begin
  if not public.profile_is_active(auth.uid()) then raise exception 'Approved active account required'; end if;
  select m.* into target
  from public.media_items m
  where m.id = target_media_item_id and m.deleted_at is null;
  if not found then raise exception 'Active media item required'; end if;
  select c.owner_id into target_owner from public.collections c where c.id = target.collection_id;
  target_key := public.media_reaction_work_key(target.type::text, target.title, target.year::integer);

  if target_owner = auth.uid() then
    if exists (
      select 1 from public.shelf_media_items smi join public.shelves s on s.id = smi.shelf_id
      where smi.media_item_id = target.id and s.show_in_main_watchlist and s.deleted_at is null
    ) then raise exception 'Included watchlist items cannot use the owner removal request'; end if;
    target_club_id := null;
  elsif target_club_id is null
    or not exists (select 1 from public.clubs c where c.id = target_club_id and c.owner_id = auth.uid())
    or not public.club_work_is_topmost(target_club_id, target_key)
  then raise exception 'Club owner request access required for a current Topmost Watchlist item'; end if;

  if not exists (
    select 1 from public.media_reactions r
    where r.kind = 'priority' and r.state = 'active' and r.work_key = target_key
      and r.user_id <> auth.uid()
      and (
        (target_club_id is null and public.can_view_media_reaction(r.user_id))
        or exists (
          select 1 from public.club_memberships cm
          where cm.club_id = target_club_id and cm.user_id = r.user_id
        )
      )
  ) then raise exception 'No requestable active Priority Stamps remain'; end if;

  with inserted as (
    insert into public.watchlist_requests(
      request_type, requester_id, target_user_id, media_item_id, club_id,
      stamp_user_id, stamp_work_key
    )
    select 'priority_stamp_removal', auth.uid(), r.user_id, target.id, target_club_id,
      r.user_id, r.work_key
    from public.media_reactions r
    where r.kind = 'priority' and r.state = 'active' and r.work_key = target_key
      and r.user_id <> auth.uid()
      and (
        (target_club_id is null and public.can_view_media_reaction(r.user_id))
        or exists (
          select 1 from public.club_memberships cm
          where cm.club_id = target_club_id and cm.user_id = r.user_id
        )
      )
      and not exists (
        select 1 from public.watchlist_requests wr
        where wr.request_type = 'priority_stamp_removal' and wr.status = 'pending'
          and wr.target_user_id = r.user_id and wr.media_item_id = target.id
          and wr.stamp_user_id = r.user_id and wr.stamp_work_key = r.work_key
      )
    on conflict do nothing
    returning target_user_id
  )
  select count(*) into created_count from inserted;

  update public.media_reactions r set state = 'removal_requested', updated_at = now()
  where r.kind = 'priority' and r.work_key = target_key
    and exists (
      select 1 from public.watchlist_requests wr
      where wr.request_type = 'priority_stamp_removal' and wr.status = 'pending'
        and wr.media_item_id = target.id and wr.target_user_id = r.user_id
    );

  delete from public.media_interest i using public.media_items m
  where i.media_item_id = m.id
    and public.media_reaction_work_key(m.type::text, m.title, m.year::integer) = target_key
    and exists (
      select 1 from public.watchlist_requests wr
      where wr.request_type = 'priority_stamp_removal' and wr.status = 'pending'
        and wr.media_item_id = target.id and wr.target_user_id = i.user_id
    );

  select count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'accepted')
  into awaiting_count, cleared_count
  from public.watchlist_requests
  where request_type = 'priority_stamp_removal'
    and requester_id = auth.uid() and media_item_id = target.id;

  return jsonb_build_object(
    'created', created_count, 'awaiting', awaiting_count, 'cleared', cleared_count,
    'message', format('Priority stamp removal requested from %s %s', created_count,
      case when created_count = 1 then 'person' else 'people' end)
  );
end $$;

create or replace function public.request_watched_item_move(
  target_club_id uuid,
  target_media_item_id uuid,
  target_source_shelf_id uuid
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  target_owner uuid;
  target_name text;
  source_name text;
  request_id uuid;
begin
  if not public.profile_is_active(auth.uid())
    or not exists (select 1 from public.clubs c where c.id = target_club_id and c.owner_id = auth.uid())
  then raise exception 'Club owner access required'; end if;

  select c.owner_id, p.display_name, s.name into target_owner, target_name, source_name
  from public.media_items m
  join public.collections c on c.id = m.collection_id
  join public.profiles p on p.id = c.owner_id
  join public.shelf_media_items smi on smi.media_item_id = m.id
  join public.shelves s on s.id = smi.shelf_id and s.collection_id = c.id
  where m.id = target_media_item_id and m.deleted_at is null
    and s.id = target_source_shelf_id and s.deleted_at is null and s.show_in_main_watchlist
    and exists (
      select 1 from public.club_memberships cm
      where cm.club_id = target_club_id and cm.user_id = c.owner_id
    );
  if not found or target_owner = auth.uid() then
    raise exception 'A Club member owned item in the named included shelf is required';
  end if;

  insert into public.watchlist_requests(
    request_type, requester_id, target_user_id, media_item_id, club_id, source_shelf_id
  ) values (
    'move_watched_item', auth.uid(), target_owner, target_media_item_id, target_club_id, target_source_shelf_id
  )
  on conflict do nothing returning id into request_id;
  if request_id is null then raise exception 'A pending move request already exists for this shelf membership'; end if;

  return jsonb_build_object('id', request_id, 'target_name', target_name, 'source_shelf_name', source_name);
end $$;

create or replace function public.respond_watchlist_request(
  target_request_id uuid,
  response text,
  destination_shelf_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  wr public.watchlist_requests;
  target_media public.media_items;
  destination public.shelves;
  next_position numeric(12,6);
begin
  select * into wr from public.watchlist_requests
  where id = target_request_id and target_user_id = auth.uid() and status = 'pending'
  for update;
  if not found then raise exception 'Pending request not found'; end if;
  select * into target_media from public.media_items where id = wr.media_item_id and deleted_at is null;
  if not found then raise exception 'Active media item required'; end if;

  if wr.request_type = 'priority_stamp_removal' then
    if response = 'keep_stamp' then
      update public.media_reactions set state = 'active', updated_at = now()
      where user_id = auth.uid() and kind = 'priority' and work_key = wr.stamp_work_key;
      insert into public.media_interest(media_item_id, user_id)
      values(wr.media_item_id, auth.uid()) on conflict do nothing;
      update public.watchlist_requests set status = 'declined', final_response = response,
        resolved_at = now(), updated_at = now()
      where request_type = 'priority_stamp_removal' and target_user_id = auth.uid()
        and stamp_work_key = wr.stamp_work_key and status = 'pending';
    elsif response = 'clear_stamp' then
      delete from public.media_reactions
      where user_id = auth.uid() and kind = 'priority' and work_key = wr.stamp_work_key;
      delete from public.media_interest i using public.media_items m
      where i.media_item_id = m.id and i.user_id = auth.uid()
        and public.media_reaction_work_key(m.type::text, m.title, m.year::integer) = wr.stamp_work_key;
      update public.watchlist_requests set status = 'accepted', final_response = response,
        resolved_at = now(), updated_at = now()
      where request_type = 'priority_stamp_removal' and target_user_id = auth.uid()
        and stamp_work_key = wr.stamp_work_key and status = 'pending';
    else raise exception 'Unsupported Priority Stamp response'; end if;
  else
    if response = 'not_now' then
      return jsonb_build_object('status', 'pending');
    elsif response = 'keep_in_watchlist' then
      update public.watchlist_requests set status = 'declined', final_response = response,
        resolved_at = now(), updated_at = now() where id = wr.id;
    elsif response = 'move_to_shelf' then
      select s.* into destination from public.shelves s
      join public.collections c on c.id = s.collection_id
      where s.id = destination_shelf_id and c.owner_id = auth.uid()
        and s.deleted_at is null and not s.show_in_main_watchlist
        and s.section = case target_media.type
          when 'film' then 'screen'::public.media_section
          when 'television' then 'screen'::public.media_section
          when 'book' then 'book'::public.media_section
          else 'game'::public.media_section end;
      if not found then raise exception 'Choose a non-watchlist shelf in your collection'; end if;
      if not exists (
        select 1 from public.shelf_media_items smi join public.shelves s on s.id = smi.shelf_id
        join public.collections c on c.id = s.collection_id
        where smi.shelf_id = wr.source_shelf_id and smi.media_item_id = wr.media_item_id
          and s.show_in_main_watchlist and c.owner_id = auth.uid()
      ) then raise exception 'The requested source shelf membership no longer exists'; end if;
      select coalesce(max(position), 0) + 1000 into next_position
      from public.shelf_media_items where shelf_id = destination.id;
      insert into public.shelf_media_items(shelf_id, media_item_id, position)
      values(destination.id, wr.media_item_id, next_position)
      on conflict (shelf_id, media_item_id) do nothing;
      delete from public.shelf_media_items
      where shelf_id = wr.source_shelf_id and media_item_id = wr.media_item_id;
      if not found then raise exception 'The source shelf membership could not be moved'; end if;
      update public.watchlist_requests set status = 'accepted', final_response = response,
        resolved_at = now(), updated_at = now() where id = wr.id;
    else raise exception 'Unsupported watched-item response'; end if;
  end if;
  return jsonb_build_object('status', (select status from public.watchlist_requests where id = wr.id));
end $$;

create or replace function public.list_watchlist_requests()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', wr.id, 'request_type', wr.request_type, 'requester_id', wr.requester_id,
    'requester_name', requester.display_name, 'target_user_id', wr.target_user_id,
    'media_item_id', wr.media_item_id, 'media_item_key', coalesce(m.legacy_id, m.id::text),
    'collection_id', m.collection_id, 'media_type', m.type, 'media_title', m.title,
    'club_id', wr.club_id, 'club_name', club.name,
    'source_shelf_id', wr.source_shelf_id, 'source_shelf_name', source_shelf.name,
    'status', wr.status, 'created_at', wr.created_at
  ) order by wr.created_at), '[]'::jsonb)
  from public.watchlist_requests wr
  join public.profiles requester on requester.id = wr.requester_id
  join public.media_items m on m.id = wr.media_item_id
  left join public.clubs club on club.id = wr.club_id
  left join public.shelves source_shelf on source_shelf.id = wr.source_shelf_id
  where wr.target_user_id = auth.uid() and wr.status = 'pending';
$$;

create or replace function public.watchlist_request_actions(
  target_media_item_id uuid,
  target_club_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  target public.media_items;
  target_owner uuid;
  target_key text;
  owner_can_request boolean := false;
  club_can_request boolean := false;
begin
  select * into target from public.media_items where id = target_media_item_id and deleted_at is null;
  if not found or auth.uid() is null or not public.can_view_media_item(target_media_item_id)
  then return '{}'::jsonb; end if;
  select owner_id into target_owner from public.collections where id = target.collection_id;
  target_key := public.media_reaction_work_key(target.type::text, target.title, target.year::integer);
  owner_can_request := target_owner = auth.uid() and not exists (
    select 1 from public.shelf_media_items smi join public.shelves s on s.id = smi.shelf_id
    where smi.media_item_id = target.id and s.show_in_main_watchlist and s.deleted_at is null
  );
  club_can_request := target_club_id is not null
    and exists (select 1 from public.clubs where id = target_club_id and owner_id = auth.uid())
    and public.club_work_is_topmost(target_club_id, target_key);

  return jsonb_build_object(
    'can_request_stamp_removal', (owner_can_request or club_can_request) and exists (
      select 1 from public.media_reactions r
      where r.kind = 'priority' and r.state = 'active' and r.work_key = target_key and r.user_id <> auth.uid()
        and (
          (club_can_request and exists (
            select 1 from public.club_memberships cm
            where cm.club_id = target_club_id and cm.user_id = r.user_id
          ))
          or (owner_can_request and public.can_view_media_reaction(r.user_id))
        )
        and not exists (
          select 1 from public.watchlist_requests wr where wr.request_type = 'priority_stamp_removal'
            and wr.status = 'pending' and wr.target_user_id = r.user_id
            and wr.media_item_id = target.id and wr.stamp_work_key = r.work_key
        )
    ),
    'active_stamps', (select count(*) from public.media_reactions r where r.kind = 'priority' and r.state = 'active' and r.work_key = target_key),
    'awaiting', (select count(*) from public.watchlist_requests wr where wr.request_type = 'priority_stamp_removal'
      and wr.requester_id = auth.uid() and wr.media_item_id = target.id and wr.status = 'pending'),
    'cleared', (select count(*) from public.watchlist_requests wr where wr.request_type = 'priority_stamp_removal'
      and wr.requester_id = auth.uid() and wr.media_item_id = target.id and wr.status = 'accepted'),
    'move_options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'club_id', target_club_id, 'target_user_id', c.owner_id,
        'target_name', p.display_name, 'source_shelf_id', s.id, 'source_shelf_name', s.name
      ) order by lower(p.display_name), s.position)
      from public.shelf_media_items smi
      join public.shelves s on s.id = smi.shelf_id and s.show_in_main_watchlist and s.deleted_at is null
      join public.collections c on c.id = s.collection_id and c.id = target.collection_id
      join public.profiles p on p.id = c.owner_id
      where smi.media_item_id = target.id and target_club_id is not null
        and c.owner_id <> auth.uid()
        and exists (select 1 from public.clubs club where club.id = target_club_id and club.owner_id = auth.uid())
        and exists (select 1 from public.club_memberships cm where cm.club_id = target_club_id and cm.user_id = c.owner_id)
        and not exists (
          select 1 from public.watchlist_requests wr where wr.request_type = 'move_watched_item'
            and wr.status = 'pending' and wr.club_id = target_club_id
            and wr.target_user_id = c.owner_id and wr.media_item_id = target.id and wr.source_shelf_id = s.id
        )
    ), '[]'::jsonb)
  );
end $$;

-- Re-adding a stamp while its request is pending means "Keep my stamp".
create or replace function public.set_media_reaction(target_media_item_id uuid, reaction_kind text, reaction_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
declare
  target public.media_items;
  target_key text;
begin
  if not public.profile_is_active(auth.uid()) then raise exception 'Approved active account required'; end if;
  if reaction_kind not in ('like', 'priority') then raise exception 'Unsupported reaction'; end if;
  select * into target from public.media_items where id = target_media_item_id and deleted_at is null;
  if not found or not public.can_view_media_item(target_media_item_id) then raise exception 'Visible media item required'; end if;
  if reaction_kind = 'priority' and target.type not in ('film', 'television') then
    raise exception 'Priority Watch is only available for films and television';
  end if;
  target_key := public.media_reaction_work_key(target.type::text, target.title, target.year::integer);
  if reaction_enabled then
    insert into public.media_reactions(user_id, kind, work_key, media_type, media_title, media_year, state)
    values(auth.uid(), reaction_kind, target_key, target.type::text, target.title, target.year, 'active')
    on conflict (user_id, kind, work_key) do update set
      media_type = excluded.media_type, media_title = excluded.media_title,
      media_year = excluded.media_year, state = 'active', updated_at = now();
    if reaction_kind = 'priority' then
      update public.watchlist_requests set status = 'declined', final_response = 'keep_stamp',
        resolved_at = now(), updated_at = now()
      where request_type = 'priority_stamp_removal' and target_user_id = auth.uid()
        and stamp_work_key = target_key and status = 'pending';
    end if;
  else
    delete from public.media_reactions where user_id = auth.uid() and kind = reaction_kind and work_key = target_key;
    if reaction_kind = 'priority' then
      update public.watchlist_requests set status = 'accepted', final_response = 'clear_stamp',
        resolved_at = now(), updated_at = now()
      where request_type = 'priority_stamp_removal' and target_user_id = auth.uid()
        and stamp_work_key = target_key and status = 'pending';
    end if;
  end if;
  if reaction_kind = 'priority' then
    delete from public.media_interest i using public.media_items m
    where i.media_item_id = m.id and i.user_id = auth.uid()
      and public.media_reaction_work_key(m.type::text, m.title, m.year::integer) = target_key;
    if reaction_enabled then
      insert into public.media_interest(media_item_id, user_id)
      values(target_media_item_id, auth.uid()) on conflict do nothing;
    end if;
  end if;
end $$;

-- The progressive section RPC must never expose removal-requested stamps.
create or replace function public.load_collection_section(
  target_collection_id uuid,
  target_section public.media_section
)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare
  payload jsonb;
  reaction_rows jsonb := '[]'::jsonb;
  reaction_profiles jsonb := '[]'::jsonb;
begin
  with visible_collection as materialized (
    select c.* from public.collections c where c.id = target_collection_id limit 1
  ), section_shelves as materialized (
    select s.id, s.section, s.name, s.subtitle, s.is_queue_list, s.position,
      s.deleted_at, s.is_required, s.show_in_main_watchlist, s.main_watchlist_position
    from public.shelves s join visible_collection c on c.id = s.collection_id
    where s.section = target_section
  ), section_media as materialized (
    select m.id, m.legacy_id, m.collection_id, m.type, m.title, m.year, m.status,
      m.priority, m.poster_url, m.creator, m.format, m.platforms, m.rating,
      m.star_rating, m.owned, m.deleted_at, m.created_at, m.updated_at
    from public.media_items m join visible_collection c on c.id = m.collection_id
    where case target_section when 'screen' then m.type in ('film', 'television')
      when 'book' then m.type = 'book' when 'game' then m.type = 'game' end
  ), section_memberships as materialized (
    select smi.shelf_id, smi.media_item_id, smi.position
    from public.shelf_media_items smi join section_shelves s on s.id = smi.shelf_id
    join section_media m on m.id = smi.media_item_id
  ), section_interests as materialized (
    select i.media_item_id, i.user_id from public.media_interest i
    join section_media m on m.id = i.media_item_id
  )
  select case when not exists (select 1 from visible_collection) then null else jsonb_build_object(
    'collection', (select to_jsonb(c) from visible_collection c),
    'shelves', coalesce((select jsonb_agg(to_jsonb(s) order by s.position, s.id) from section_shelves s), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at, m.id) from section_media m), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(to_jsonb(sm) order by sm.position, sm.media_item_id) from section_memberships sm), '[]'::jsonb),
    'interests', coalesce((select jsonb_agg(to_jsonb(i)) from section_interests i), '[]'::jsonb),
    'reactions', '[]'::jsonb,
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name))
      from public.public_profiles p where exists (select 1 from section_interests i where i.user_id = p.id)), '[]'::jsonb)
  ) end into payload;
  if payload is null or auth.uid() is null then return payload; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', r.user_id, 'kind', r.kind, 'work_key', r.work_key, 'state', r.state
  )), '[]'::jsonb) into reaction_rows
  from public.media_reactions r
  where r.state = 'active' and exists (
    select 1 from public.media_items m where m.collection_id = target_collection_id
      and case target_section when 'screen' then m.type in ('film', 'television')
        when 'book' then m.type = 'book' when 'game' then m.type = 'game' end
      and r.work_key = public.media_reaction_work_key(m.type::text, m.title, m.year::integer)
  );
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name)), '[]'::jsonb)
  into reaction_profiles from public.public_profiles p
  where exists (select 1 from jsonb_array_elements(reaction_rows) reaction where reaction->>'user_id' = p.id::text);
  return payload || jsonb_build_object('reactions', reaction_rows,
    'profiles', coalesce(payload->'profiles', '[]'::jsonb) || reaction_profiles);
end $$;

revoke all on function public.club_work_is_topmost(uuid,text) from public, anon;
revoke all on function public.request_priority_stamp_removal(uuid,uuid) from public, anon;
revoke all on function public.request_watched_item_move(uuid,uuid,uuid) from public, anon;
revoke all on function public.respond_watchlist_request(uuid,text,uuid) from public, anon;
revoke all on function public.list_watchlist_requests() from public, anon;
revoke all on function public.watchlist_request_actions(uuid,uuid) from public, anon;
grant execute on function public.request_priority_stamp_removal(uuid,uuid),
  public.request_watched_item_move(uuid,uuid,uuid),
  public.respond_watchlist_request(uuid,text,uuid),
  public.list_watchlist_requests(),
  public.watchlist_request_actions(uuid,uuid) to authenticated;
revoke all on function public.load_collection_section(uuid, public.media_section) from public;
grant execute on function public.load_collection_section(uuid, public.media_section) to anon, authenticated;

notify pgrst, 'reload schema';
