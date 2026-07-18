-- Friends, member-managed Clubs, invitations, and Club-scoped Main Watchlists.

-- Permanently fix share-token rotation on Supabase installations where pgcrypto
-- lives in the extensions schema.
create or replace function public.create_collection_share(target_collection_id uuid, rotate_token boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare link public.collection_share_links;
begin
  if not public.owns_active_collection(target_collection_id) then raise exception 'Collection owner access required'; end if;
  insert into public.collection_share_links (collection_id) values (target_collection_id)
  on conflict (collection_id) do update set
    token = case when rotate_token then encode(extensions.gen_random_bytes(32), 'hex') else collection_share_links.token end,
    enabled = true, updated_at = now()
  returning * into link;
  return jsonb_build_object('token', link.token, 'enabled', link.enabled, 'updated_at', link.updated_at);
end $$;

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'ignored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id), unique (requester_id, recipient_id)
);
create table public.friendships (
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high), check (user_low::text < user_high::text)
);
create index friend_requests_recipient_status_idx on public.friend_requests(recipient_id, status);
create index friendships_high_idx on public.friendships(user_high, user_low);
create trigger friend_requests_set_updated_at before update on public.friend_requests for each row execute function public.set_updated_at();
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
revoke all on public.friend_requests from public, anon, authenticated;
revoke all on public.friendships from public, anon, authenticated;

alter table public.clubs add column if not exists owner_id uuid references public.profiles(id) on delete restrict;
update public.clubs c set owner_id = coalesce(
  (select p.id from public.profiles p where lower(p.username) = 'christopher' and p.role = 'admin' limit 1),
  c.created_by,
  (select p.id from public.profiles p where p.role = 'admin' order by p.created_at limit 1))
where owner_id is null;
-- Existing Clubs predate member ownership and belong to Christopher. Keep the
-- historical creator column aligned so old admin screens report the same owner.
update public.clubs c set created_by = c.owner_id where c.created_by is distinct from c.owner_id;
alter table public.clubs alter column owner_id set default auth.uid();
alter table public.clubs alter column owner_id set not null;
insert into public.club_memberships (club_id, user_id, created_by)
select c.id, c.owner_id, c.owner_id from public.clubs c on conflict do nothing;

create table public.club_invitations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  status text not null default 'pending' check (status in ('pending', 'ignored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, invited_user_id)
);
create index club_invitations_user_status_idx on public.club_invitations(invited_user_id, status);
create trigger club_invitations_set_updated_at before update on public.club_invitations for each row execute function public.set_updated_at();
alter table public.club_invitations enable row level security;
revoke all on public.club_invitations from public, anon, authenticated;

create or replace function public.are_friends(target_profile_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and exists (
    select 1 from public.friendships f
    where (f.user_low = least(auth.uid(), target_profile_id) and f.user_high = greatest(auth.uid(), target_profile_id))
  );
$$;

create or replace function public.can_view_profile(target_profile_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.profile_is_active(target_profile_id) and (
    public.is_admin() or target_profile_id = auth.uid() or public.is_kit_profile(target_profile_id)
    or public.shares_club_with(target_profile_id) or public.are_friends(target_profile_id)
  );
$$;
create or replace function public.can_view_collection(target_collection_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.collections c where c.id = target_collection_id
    and public.profile_is_active(c.owner_id) and (
      public.is_admin() or c.owner_id = auth.uid() or c.slug = 'kits-collection'
      or public.shares_club_with(c.owner_id) or public.are_friends(c.owner_id)
    ));
$$;

create or replace function public.list_user_hub()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.profile_is_active(auth.uid()) then raise exception 'Approved active account required'; end if;
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'username', p.username, 'display_name', p.display_name,
      'friend', public.are_friends(p.id),
      'incoming', exists(select 1 from public.friend_requests r where r.requester_id=p.id and r.recipient_id=auth.uid() and r.status='pending'),
      'incoming_request_id', (select r.id from public.friend_requests r where r.requester_id=p.id and r.recipient_id=auth.uid() and r.status='pending' limit 1),
      'outgoing', exists(select 1 from public.friend_requests r where r.requester_id=auth.uid() and r.recipient_id=p.id and r.status='pending'),
      'shared_clubs', coalesce((select jsonb_agg(c.name order by lower(c.name)) from public.clubs c
        join public.club_memberships mine on mine.club_id=c.id and mine.user_id=auth.uid()
        join public.club_memberships theirs on theirs.club_id=c.id and theirs.user_id=p.id), '[]'::jsonb)
    ) order by lower(p.display_name), lower(p.username)) from public.profiles p
      where p.id<>auth.uid() and p.approved_at is not null and p.rejected_at is null and p.deactivated_at is null), '[]'::jsonb),
    'clubs', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'owner_id', c.owner_id,
      'member_ids', coalesce((select jsonb_agg(cm.user_id order by cm.created_at) from public.club_memberships cm
        join public.profiles mp on mp.id=cm.user_id where cm.club_id=c.id and mp.approved_at is not null and mp.rejected_at is null and mp.deactivated_at is null), '[]'::jsonb)
    ) order by lower(c.name)) from public.clubs c join public.club_memberships mine on mine.club_id=c.id and mine.user_id=auth.uid()), '[]'::jsonb),
    'club_invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'club_id', c.id, 'club_name', c.name, 'invited_by', p.display_name) order by i.created_at)
      from public.club_invitations i join public.clubs c on c.id=i.club_id join public.profiles p on p.id=i.invited_by
      where i.invited_user_id=auth.uid() and i.status='pending'), '[]'::jsonb),
    'notification_count', (select count(*) from public.friend_requests r where r.recipient_id=auth.uid() and r.status='pending')
      + (select count(*) from public.club_invitations i where i.invited_user_id=auth.uid() and i.status='pending')
  );
end $$;

create or replace function public.request_friend(target_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.profile_is_active(auth.uid()) or not public.profile_is_active(target_user_id) or target_user_id=auth.uid() then raise exception 'Friend request not allowed'; end if;
  if public.are_friends(target_user_id) then return; end if;
  insert into public.friend_requests(requester_id, recipient_id, status) values(auth.uid(), target_user_id, 'pending')
  on conflict(requester_id, recipient_id) do update set status='pending', updated_at=now();
end $$;
create or replace function public.request_friend_from_share(share_token text)
returns void language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
  select c.owner_id into target from public.collection_share_links l join public.collections c on c.id=l.collection_id
    where l.token=share_token and l.enabled and public.profile_is_active(c.owner_id);
  if target is null then raise exception 'Share link unavailable'; end if;
  perform public.request_friend(target);
end $$;
create or replace function public.respond_friend_request(request_id uuid, accept_request boolean)
returns void language plpgsql security definer set search_path=public as $$
declare r public.friend_requests;
begin
  select * into r from public.friend_requests where id=request_id and recipient_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'Friend request not found'; end if;
  if accept_request then
    insert into public.friendships(user_low,user_high) values(least(r.requester_id,r.recipient_id),greatest(r.requester_id,r.recipient_id)) on conflict do nothing;
    delete from public.friend_requests where (requester_id=r.requester_id and recipient_id=r.recipient_id) or (requester_id=r.recipient_id and recipient_id=r.requester_id);
  else update public.friend_requests set status='ignored' where id=request_id; end if;
end $$;
create or replace function public.cancel_friend_request(target_user_id uuid)
returns void language sql security definer set search_path=public as $$ delete from public.friend_requests where requester_id=auth.uid() and recipient_id=target_user_id and status='pending' $$;
create or replace function public.unfriend(target_user_id uuid)
returns void language sql security definer set search_path=public as $$ delete from public.friendships where user_low=least(auth.uid(),target_user_id) and user_high=greatest(auth.uid(),target_user_id) $$;

create or replace function public.create_member_club(club_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.clubs;
begin
  if not public.profile_is_active(auth.uid()) then raise exception 'Approved active account required'; end if;
  insert into public.clubs(name,owner_id,created_by) values(trim(club_name),auth.uid(),auth.uid()) returning * into c;
  insert into public.club_memberships(club_id,user_id,created_by) values(c.id,auth.uid(),auth.uid());
  return jsonb_build_object('id',c.id,'name',c.name,'owner_id',c.owner_id,'member_ids',jsonb_build_array(auth.uid()));
end $$;
create or replace function public.invite_to_club(target_club_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.clubs where id=target_club_id and owner_id=auth.uid()) then raise exception 'Club owner access required'; end if;
  if not public.profile_is_active(target_user_id) or exists(select 1 from public.club_memberships where club_id=target_club_id and user_id=target_user_id) then raise exception 'User cannot be invited'; end if;
  insert into public.club_invitations(club_id,invited_user_id,invited_by,status) values(target_club_id,target_user_id,auth.uid(),'pending')
  on conflict(club_id,invited_user_id) do update set invited_by=auth.uid(),status='pending',updated_at=now();
end $$;
create or replace function public.respond_club_invitation(invitation_id uuid, accept_invitation boolean)
returns void language plpgsql security definer set search_path=public as $$
declare i public.club_invitations;
begin
  select * into i from public.club_invitations where id=invitation_id and invited_user_id=auth.uid() and status='pending' for update;
  if not found then raise exception 'Club invitation not found'; end if;
  if accept_invitation then insert into public.club_memberships(club_id,user_id,created_by) values(i.club_id,auth.uid(),i.invited_by) on conflict do nothing; delete from public.club_invitations where id=i.id;
  else update public.club_invitations set status='ignored' where id=i.id; end if;
end $$;
create or replace function public.transfer_club_ownership(target_club_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.clubs where id=target_club_id and owner_id=auth.uid()) then raise exception 'Club owner access required'; end if;
  if not exists(select 1 from public.club_memberships where club_id=target_club_id and user_id=target_user_id) then raise exception 'New owner must be a member'; end if;
  update public.clubs set owner_id=target_user_id where id=target_club_id;
end $$;
create or replace function public.leave_club(target_club_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare owner uuid; members integer;
begin
  select owner_id into owner from public.clubs where id=target_club_id;
  select count(*) into members from public.club_memberships where club_id=target_club_id;
  if owner=auth.uid() and members>1 then raise exception 'Transfer Club ownership before leaving'; end if;
  if owner=auth.uid() then delete from public.clubs where id=target_club_id;
  else delete from public.club_memberships where club_id=target_club_id and user_id=auth.uid(); end if;
end $$;

revoke all on function public.are_friends(uuid) from public;
grant execute on function public.are_friends(uuid) to anon, authenticated;
revoke all on function public.list_user_hub() from public, anon;
revoke all on function public.request_friend(uuid) from public, anon;
revoke all on function public.request_friend_from_share(text) from public, anon;
revoke all on function public.respond_friend_request(uuid,boolean) from public, anon;
revoke all on function public.cancel_friend_request(uuid) from public, anon;
revoke all on function public.unfriend(uuid) from public, anon;
revoke all on function public.create_member_club(text) from public, anon;
revoke all on function public.invite_to_club(uuid,uuid) from public, anon;
revoke all on function public.respond_club_invitation(uuid,boolean) from public, anon;
revoke all on function public.transfer_club_ownership(uuid,uuid) from public, anon;
revoke all on function public.leave_club(uuid) from public, anon;
grant execute on function public.list_user_hub(), public.request_friend(uuid), public.request_friend_from_share(text), public.respond_friend_request(uuid,boolean), public.cancel_friend_request(uuid), public.unfriend(uuid), public.create_member_club(text), public.invite_to_club(uuid,uuid), public.respond_club_invitation(uuid,boolean), public.transfer_club_ownership(uuid,uuid), public.leave_club(uuid) to authenticated;
grant execute on function public.create_collection_share(uuid,boolean) to authenticated;
notify pgrst, 'reload schema';
