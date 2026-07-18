-- Owner-managed Club membership and invitation state for the People & Clubs UI.

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
        join public.profiles mp on mp.id=cm.user_id where cm.club_id=c.id and mp.approved_at is not null and mp.rejected_at is null and mp.deactivated_at is null), '[]'::jsonb),
      'pending_invitee_ids', case when c.owner_id=auth.uid() then coalesce((select jsonb_agg(i.invited_user_id order by i.created_at)
        from public.club_invitations i where i.club_id=c.id and i.status='pending'), '[]'::jsonb) else '[]'::jsonb end
    ) order by lower(c.name)) from public.clubs c join public.club_memberships mine on mine.club_id=c.id and mine.user_id=auth.uid()), '[]'::jsonb),
    'club_invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'club_id', c.id, 'club_name', c.name, 'invited_by', p.display_name) order by i.created_at)
      from public.club_invitations i join public.clubs c on c.id=i.club_id join public.profiles p on p.id=i.invited_by
      where i.invited_user_id=auth.uid() and i.status='pending'), '[]'::jsonb),
    'notification_count', (select count(*) from public.friend_requests r where r.recipient_id=auth.uid() and r.status='pending')
      + (select count(*) from public.club_invitations i where i.invited_user_id=auth.uid() and i.status='pending')
  );
end $$;

create or replace function public.invite_to_club(target_club_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.clubs where id=target_club_id and owner_id=auth.uid()) then raise exception 'Club owner access required'; end if;
  if not public.profile_is_active(target_user_id) or not public.are_friends(target_user_id)
    or exists(select 1 from public.club_memberships where club_id=target_club_id and user_id=target_user_id)
  then raise exception 'Only eligible friends can be invited'; end if;
  insert into public.club_invitations(club_id,invited_user_id,invited_by,status) values(target_club_id,target_user_id,auth.uid(),'pending')
  on conflict(club_id,invited_user_id) do update set invited_by=auth.uid(),status='pending',updated_at=now();
end $$;

create or replace function public.remove_club_member(target_club_id uuid, target_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.clubs where id=target_club_id and owner_id=auth.uid()) then raise exception 'Club owner access required'; end if;
  if target_user_id=auth.uid() then raise exception 'Transfer ownership before leaving'; end if;
  delete from public.club_memberships where club_id=target_club_id and user_id=target_user_id;
  if not found then raise exception 'Club member not found'; end if;
  delete from public.club_invitations where club_id=target_club_id and invited_user_id=target_user_id;
end $$;

revoke all on function public.remove_club_member(uuid,uuid) from public, anon;
grant execute on function public.remove_club_member(uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
