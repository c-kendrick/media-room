-- Resolve obsolete watchlist requests and add owner-managed collaborative shelves.

create or replace function public.resolve_deleted_media_watchlist_requests()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    update public.watchlist_requests
    set status='accepted', final_response='item_deleted', resolved_at=now(), updated_at=now()
    where request_type='move_watched_item' and media_item_id=new.id and status='pending';
    return new;
  end if;
  if tg_op = 'DELETE' then
    delete from public.watchlist_requests
    where request_type='move_watched_item' and media_item_id=old.id and status='pending';
    return old;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists resolve_deleted_media_watchlist_requests on public.media_items;
create trigger resolve_deleted_media_watchlist_requests
before update of deleted_at or delete on public.media_items
for each row execute function public.resolve_deleted_media_watchlist_requests();

create table public.shelf_collaborations (
  id uuid primary key default gen_random_uuid(),
  shelf_id uuid not null references public.shelves(id) on delete cascade,
  collaborator_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  invited_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text check (revocation_reason in ('owner_revoked', 'social_access_lost')),
  popup_acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shelf_id, collaborator_id),
  check ((active and revoked_at is null and revocation_reason is null)
    or (not active and revoked_at is not null and revocation_reason is not null))
);
create index shelf_collaborations_collaborator_active_idx
  on public.shelf_collaborations(collaborator_id, active, invited_at desc);
create trigger shelf_collaborations_set_updated_at before update on public.shelf_collaborations
for each row execute function public.set_updated_at();

alter table public.shelf_collaborations enable row level security;
revoke all on public.shelf_collaborations from public, anon, authenticated;
create policy "Shelf collaboration participants can read invitations"
on public.shelf_collaborations for select to authenticated
using (
  collaborator_id=auth.uid() or exists (
    select 1 from public.shelves s join public.collections c on c.id=s.collection_id
    where s.id=shelf_id and (c.owner_id=auth.uid() or public.is_admin())
  )
);
grant select on public.shelf_collaborations to authenticated;

alter table public.media_items
  add column if not exists contributor_id uuid references public.profiles(id) on delete set null,
  add column if not exists contributed_to_shelf_id uuid references public.shelves(id) on delete set null;
alter table public.media_items drop constraint if exists media_items_collaboration_provenance;
alter table public.media_items add constraint media_items_collaboration_provenance
  check ((contributor_id is null and contributed_to_shelf_id is null)
    or (contributor_id is not null and contributed_to_shelf_id is not null));
create index if not exists media_items_contributor_idx
  on public.media_items(contributor_id, contributed_to_shelf_id) where contributor_id is not null;

create or replace function public.collaboration_socially_eligible(owner_user_id uuid, collaborator_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select owner_user_id<>collaborator_user_id
    and public.profile_is_active(owner_user_id)
    and public.profile_is_active(collaborator_user_id)
    and (
      exists (
        select 1 from public.friendships f
        where f.user_low=least(owner_user_id,collaborator_user_id)
          and f.user_high=greatest(owner_user_id,collaborator_user_id)
      )
      or exists (
        select 1 from public.club_memberships owner_membership
        join public.club_memberships collaborator_membership
          on collaborator_membership.club_id=owner_membership.club_id
        where owner_membership.user_id=owner_user_id
          and collaborator_membership.user_id=collaborator_user_id
      )
    );
$$;

create or replace function public.shelf_collaboration_is_active(target_shelf_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select (target_user_id=auth.uid() or public.is_admin()) and exists (
    select 1
    from public.shelf_collaborations collaboration
    join public.shelves shelf on shelf.id=collaboration.shelf_id and shelf.deleted_at is null
    join public.libraries library on library.id=shelf.library_id and library.deleted_at is null
    join public.collections collection on collection.id=shelf.collection_id
    where collaboration.shelf_id=target_shelf_id
      and collaboration.collaborator_id=target_user_id
      and collaboration.active
      and public.collaboration_socially_eligible(collection.owner_id,target_user_id)
  );
$$;

create or replace function public.collaborative_media_membership_is_valid(
  target_media_item_id uuid,
  target_shelf_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean language sql stable security definer set search_path=public as $$
  select (target_user_id=auth.uid() or public.is_admin()) and exists (
    select 1 from public.shelf_media_items membership
    where membership.shelf_id=target_shelf_id and membership.media_item_id=target_media_item_id
  );
$$;

create or replace function public.revoke_ineligible_shelf_collaborations()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.shelf_collaborations collaboration
  set active=false, revoked_at=now(), revocation_reason='social_access_lost', updated_at=now()
  from public.shelves shelf, public.collections collection
  where collaboration.active and shelf.id=collaboration.shelf_id
    and collection.id=shelf.collection_id
    and not public.collaboration_socially_eligible(collection.owner_id,collaboration.collaborator_id);
  return null;
end $$;

drop trigger if exists revoke_collaboration_after_unfriend on public.friendships;
create trigger revoke_collaboration_after_unfriend
after delete on public.friendships for each statement
execute function public.revoke_ineligible_shelf_collaborations();
drop trigger if exists revoke_collaboration_after_club_change on public.club_memberships;
create trigger revoke_collaboration_after_club_change
after delete on public.club_memberships for each statement
execute function public.revoke_ineligible_shelf_collaborations();
drop trigger if exists revoke_collaboration_after_profile_change on public.profiles;
create trigger revoke_collaboration_after_profile_change
after update of approved_at, rejected_at, deactivated_at on public.profiles for each statement
execute function public.revoke_ineligible_shelf_collaborations();

create or replace function public.set_shelf_collaborator(
  target_shelf_id uuid,
  target_user_id uuid,
  collaboration_enabled boolean
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  target_owner uuid;
  result public.shelf_collaborations;
begin
  select collection.owner_id into target_owner
  from public.shelves shelf
  join public.libraries library on library.id=shelf.library_id and library.deleted_at is null
  join public.collections collection on collection.id=shelf.collection_id
  where shelf.id=target_shelf_id and shelf.deleted_at is null;
  if target_owner is null or target_owner<>auth.uid() then raise exception 'Shelf owner access required'; end if;
  if target_user_id=auth.uid() then raise exception 'Shelf owners already have full access'; end if;

  if collaboration_enabled then
    if not public.collaboration_socially_eligible(target_owner,target_user_id) then
      raise exception 'Collaboration requires a current friendship or mutual Club';
    end if;
    insert into public.shelf_collaborations(
      shelf_id,collaborator_id,invited_by,active,invited_at,revoked_at,revocation_reason,popup_acknowledged_at
    ) values (
      target_shelf_id,target_user_id,auth.uid(),true,now(),null,null,null
    )
    on conflict(shelf_id,collaborator_id) do update set
      invited_by=auth.uid(), active=true, invited_at=now(), revoked_at=null,
      revocation_reason=null, popup_acknowledged_at=null, updated_at=now()
    returning * into result;
  else
    update public.shelf_collaborations set
      active=false, revoked_at=now(), revocation_reason='owner_revoked', updated_at=now()
    where shelf_id=target_shelf_id and collaborator_id=target_user_id and active
    returning * into result;
    if not found then raise exception 'Active collaboration not found'; end if;
  end if;
  return to_jsonb(result);
end $$;

create or replace function public.acknowledge_shelf_collaboration(target_collaboration_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.shelf_collaborations set popup_acknowledged_at=coalesce(popup_acknowledged_at,now()), updated_at=now()
  where id=target_collaboration_id and collaborator_id=auth.uid();
  if not found then raise exception 'Collaboration notification not found'; end if;
end $$;

create or replace function public.create_collaborative_shelf_item(target_shelf_id uuid, item_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  target_shelf public.shelves;
  target_library public.libraries;
  item_type public.media_type;
  created public.media_items;
begin
  if not public.profile_is_active(auth.uid()) then raise exception 'Approved active account required'; end if;
  select * into target_shelf from public.shelves where id=target_shelf_id and deleted_at is null for share;
  if not found then raise exception 'Active shelf collaboration required'; end if;
  perform 1 from public.shelf_collaborations collaboration
  where collaboration.shelf_id=target_shelf_id and collaboration.collaborator_id=auth.uid() and collaboration.active
  for update;
  if not found or not public.shelf_collaboration_is_active(target_shelf_id,auth.uid()) then
    raise exception 'Active shelf collaboration required';
  end if;
  select * into target_library from public.libraries
  where id=target_shelf.library_id and collection_id=target_shelf.collection_id and deleted_at is null;
  if not found then raise exception 'Active destination library required'; end if;
  begin item_type := (item_payload->>'type')::public.media_type;
  exception when others then raise exception 'Unsupported media type'; end;
  if trim(coalesce(item_payload->>'title',''))='' then raise exception 'Media title required'; end if;
  if not ((target_library.type='screen' and item_type in ('film','television'))
    or target_library.type::text=item_type::text
    or (target_library.type='other' and item_type='other')) then
    raise exception 'Media type is incompatible with this shelf';
  end if;

  insert into public.media_items(
    collection_id,library_id,type,title,year,notes,poster_url,creator,director,description,
    format,platforms,genres,runtime,owned,contributor_id,contributed_to_shelf_id
  ) values (
    target_shelf.collection_id,target_shelf.library_id,item_type,trim(item_payload->>'title'),
    nullif(item_payload->>'year','')::smallint,nullif(item_payload->>'notes',''),
    nullif(item_payload->>'poster_url',''),nullif(item_payload->>'creator',''),
    nullif(item_payload->>'director',''),nullif(item_payload->>'description',''),
    nullif(item_payload->>'format',''),
    case when jsonb_typeof(item_payload->'platforms')='array'
      then array(select jsonb_array_elements_text(item_payload->'platforms')) else '{}'::text[] end,
    case when jsonb_typeof(item_payload->'genres')='array'
      then array(select jsonb_array_elements_text(item_payload->'genres')) else '{}'::text[] end,
    nullif(item_payload->>'runtime','')::integer,coalesce((item_payload->>'owned')::boolean,false),
    auth.uid(),target_shelf_id
  ) returning * into created;
  insert into public.shelf_media_items(shelf_id,media_item_id,position)
  values(target_shelf_id,created.id,
    coalesce((select max(position) from public.shelf_media_items where shelf_id=target_shelf_id),0)+1000);
  return to_jsonb(created);
end $$;

create or replace function public.enforce_collaborative_media_integrity()
returns trigger language plpgsql set search_path=public as $$
begin
  if public.can_manage_collection(old.collection_id) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if old.contributor_id is distinct from auth.uid()
    or old.contributed_to_shelf_id is null
    or not public.shelf_collaboration_is_active(old.contributed_to_shelf_id,auth.uid())
    or not public.collaborative_media_membership_is_valid(old.id,old.contributed_to_shelf_id,auth.uid()) then
    raise exception 'Contributor access required';
  end if;
  if tg_op='UPDATE' and (
    new.contributor_id is distinct from old.contributor_id
    or new.contributed_to_shelf_id is distinct from old.contributed_to_shelf_id
    or new.collection_id is distinct from old.collection_id
    or new.library_id is distinct from old.library_id
  ) then raise exception 'Collaborative item provenance cannot be changed'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists enforce_collaborative_media_integrity on public.media_items;
create trigger enforce_collaborative_media_integrity
before update or delete on public.media_items
for each row when (old.contributor_id is not null)
execute function public.enforce_collaborative_media_integrity();

create policy "Active collaborators can update their contributed media"
on public.media_items for update to authenticated
using (
  contributor_id=auth.uid() and contributed_to_shelf_id is not null
  and public.shelf_collaboration_is_active(contributed_to_shelf_id,auth.uid())
  and public.collaborative_media_membership_is_valid(media_items.id,contributed_to_shelf_id,auth.uid())
)
with check (
  contributor_id=auth.uid() and contributed_to_shelf_id is not null
  and public.shelf_collaboration_is_active(contributed_to_shelf_id,auth.uid())
  and public.collaborative_media_membership_is_valid(media_items.id,contributed_to_shelf_id,auth.uid())
  and exists (
    select 1 from public.shelves shelf
    where shelf.id=contributed_to_shelf_id and shelf.collection_id=media_items.collection_id
      and shelf.library_id=media_items.library_id
  )
);
create policy "Active collaborators can delete their contributed media"
on public.media_items for delete to authenticated
using (
  contributor_id=auth.uid() and contributed_to_shelf_id is not null
  and public.shelf_collaboration_is_active(contributed_to_shelf_id,auth.uid())
  and public.collaborative_media_membership_is_valid(media_items.id,contributed_to_shelf_id,auth.uid())
);

-- Keep the People hub authoritative for collaboration candidates and persistent invitation history.
create or replace function public.list_user_hub()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.profile_is_active(auth.uid()) then raise exception 'Approved active account required'; end if;
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'username',p.username,'display_name',p.display_name,
      'friend',public.are_friends(p.id),
      'incoming',exists(select 1 from public.friend_requests r where r.requester_id=p.id and r.recipient_id=auth.uid() and r.status='pending'),
      'incoming_request_id',(select r.id from public.friend_requests r where r.requester_id=p.id and r.recipient_id=auth.uid() and r.status='pending' limit 1),
      'outgoing',exists(select 1 from public.friend_requests r where r.requester_id=auth.uid() and r.recipient_id=p.id and r.status='pending'),
      'shared_clubs',coalesce((select jsonb_agg(c.name order by lower(c.name)) from public.clubs c
        join public.club_memberships mine on mine.club_id=c.id and mine.user_id=auth.uid()
        join public.club_memberships theirs on theirs.club_id=c.id and theirs.user_id=p.id),'[]'::jsonb)
    ) order by lower(p.display_name),lower(p.username)) from public.profiles p
      where p.id<>auth.uid() and p.approved_at is not null and p.rejected_at is null and p.deactivated_at is null),'[]'::jsonb),
    'clubs',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'owner_id',c.owner_id,
      'member_ids',coalesce((select jsonb_agg(cm.user_id order by cm.created_at) from public.club_memberships cm
        join public.profiles mp on mp.id=cm.user_id where cm.club_id=c.id and mp.approved_at is not null and mp.rejected_at is null and mp.deactivated_at is null),'[]'::jsonb),
      'pending_invitee_ids',case when c.owner_id=auth.uid() then coalesce((select jsonb_agg(i.invited_user_id order by i.created_at)
        from public.club_invitations i where i.club_id=c.id and i.status='pending'),'[]'::jsonb) else '[]'::jsonb end
    ) order by lower(c.name)) from public.clubs c join public.club_memberships mine on mine.club_id=c.id and mine.user_id=auth.uid()),'[]'::jsonb),
    'club_invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'club_id',c.id,'club_name',c.name,'invited_by',p.display_name) order by i.created_at)
      from public.club_invitations i join public.clubs c on c.id=i.club_id join public.profiles p on p.id=i.invited_by
      where i.invited_user_id=auth.uid() and i.status='pending'),'[]'::jsonb),
    'shelf_collaboration_notifications',coalesce((select jsonb_agg(jsonb_build_object(
      'id',collaboration.id,'shelf_id',shelf.id,'shelf_name',shelf.name,
      'collection_id',collection.id,'library_id',shelf.library_id,'owner_name',owner_profile.display_name,
      'invited_at',collaboration.invited_at,'popup_acknowledged_at',collaboration.popup_acknowledged_at
    ) order by collaboration.invited_at desc)
      from public.shelf_collaborations collaboration
      join public.shelves shelf on shelf.id=collaboration.shelf_id and shelf.deleted_at is null
      join public.libraries library on library.id=shelf.library_id and library.deleted_at is null
      join public.collections collection on collection.id=shelf.collection_id
      join public.profiles owner_profile on owner_profile.id=collection.owner_id
      where collaboration.collaborator_id=auth.uid() and collaboration.active
        and public.collaboration_socially_eligible(collection.owner_id,auth.uid())),'[]'::jsonb),
    'notification_count',(select count(*) from public.friend_requests r where r.recipient_id=auth.uid() and r.status='pending')
      +(select count(*) from public.club_invitations i where i.invited_user_id=auth.uid() and i.status='pending')
      +(select count(*) from public.shelf_collaborations collaboration
        join public.shelves shelf on shelf.id=collaboration.shelf_id
        join public.collections collection on collection.id=shelf.collection_id
        where collaboration.collaborator_id=auth.uid() and collaboration.active
          and collaboration.popup_acknowledged_at is null
          and public.collaboration_socially_eligible(collection.owner_id,auth.uid()))
  );
end $$;

-- Include collaboration capability and contributor attribution in library snapshots.
create or replace function public.load_collection_library(target_collection_id uuid, target_library_id uuid default null)
returns jsonb language sql stable security definer set search_path=public as $$
  with visible_collection as materialized (
    select c.* from public.collections c where c.id=target_collection_id and public.can_view_collection(c.id) limit 1
  ), active_libraries as materialized (
    select l.* from public.libraries l join visible_collection c on c.id=l.collection_id where l.deleted_at is null
  ), chosen as materialized (
    select l.* from active_libraries l order by (l.id=target_library_id) desc,
      (l.is_protected and l.type='screen') desc,l.is_protected desc,l.position,l.created_at,l.id limit 1
  ), library_shelves as materialized (
    select s.*,
      public.shelf_collaboration_is_active(s.id,auth.uid()) as can_collaborate,
      exists(select 1 from public.shelf_collaborations sc where sc.shelf_id=s.id and sc.active
        and public.collaboration_socially_eligible((select owner_id from visible_collection),sc.collaborator_id)) as collaborative,
      case when (select owner_id from visible_collection)=auth.uid() or public.is_admin() then coalesce((
        select jsonb_agg(sc.collaborator_id order by sc.invited_at)
        from public.shelf_collaborations sc where sc.shelf_id=s.id and sc.active
          and public.collaboration_socially_eligible((select owner_id from visible_collection),sc.collaborator_id)
      ),'[]'::jsonb) else '[]'::jsonb end as collaborator_ids
    from public.shelves s join chosen l on l.id=s.library_id
  ), library_media as materialized (
    select m.* from public.media_items m join chosen l on l.id=m.library_id
  ), memberships as materialized (
    select sm.* from public.shelf_media_items sm join library_shelves s on s.id=sm.shelf_id
    join library_media m on m.id=sm.media_item_id
  ), interests as materialized (
    select i.* from public.media_interest i join library_media m on m.id=i.media_item_id
  ), reactions as materialized (
    select r.* from public.media_reactions r where r.state='active' and exists (
      select 1 from library_media m where public.media_reaction_work_key(m.type::text,m.title,m.year::integer)=r.work_key
    )
  )
  select case when not exists(select 1 from visible_collection) then null else jsonb_build_object(
    'collection',(select to_jsonb(c) from visible_collection c),
    'libraries',coalesce((select jsonb_agg(to_jsonb(l) order by l.is_protected desc,l.position,l.created_at,l.id) from active_libraries l),'[]'::jsonb),
    'library',(select to_jsonb(l) from chosen l),
    'shelves',coalesce((select jsonb_agg(to_jsonb(s) order by s.position,s.id) from library_shelves s),'[]'::jsonb),
    'media',coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from library_media m),'[]'::jsonb),
    'memberships',coalesce((select jsonb_agg(to_jsonb(sm) order by sm.position,sm.media_item_id) from memberships sm),'[]'::jsonb),
    'interests',coalesce((select jsonb_agg(to_jsonb(i)) from interests i),'[]'::jsonb),
    'reactions',coalesce((select jsonb_agg(to_jsonb(r)) from reactions r),'[]'::jsonb),
    'profiles',coalesce((select jsonb_agg(to_jsonb(p)) from public.public_profiles p where exists(
      select 1 from interests i where i.user_id=p.id
      union all select 1 from reactions r where r.user_id=p.id
      union all select 1 from library_media m where m.contributor_id=p.id
    )),'[]'::jsonb)
  ) end;
$$;

revoke all on function public.resolve_deleted_media_watchlist_requests() from public;
revoke all on function public.collaboration_socially_eligible(uuid,uuid) from public;
revoke all on function public.shelf_collaboration_is_active(uuid,uuid) from public;
revoke all on function public.collaborative_media_membership_is_valid(uuid,uuid,uuid) from public;
revoke all on function public.revoke_ineligible_shelf_collaborations() from public;
revoke all on function public.set_shelf_collaborator(uuid,uuid,boolean) from public,anon;
revoke all on function public.acknowledge_shelf_collaboration(uuid) from public,anon;
revoke all on function public.create_collaborative_shelf_item(uuid,jsonb) from public,anon;
revoke all on function public.enforce_collaborative_media_integrity() from public;
grant execute on function public.shelf_collaboration_is_active(uuid,uuid) to authenticated;
grant execute on function public.collaborative_media_membership_is_valid(uuid,uuid,uuid) to authenticated;
grant execute on function public.set_shelf_collaborator(uuid,uuid,boolean),
  public.acknowledge_shelf_collaboration(uuid),
  public.create_collaborative_shelf_item(uuid,jsonb) to authenticated;
revoke all on function public.load_collection_library(uuid,uuid) from public;
grant execute on function public.load_collection_library(uuid,uuid) to anon,authenticated;

notify pgrst, 'reload schema';
