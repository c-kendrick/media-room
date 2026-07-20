-- Reactions are personal social data. Collection visibility alone (including
-- Kit's special public collection, Open accounts, and admin collection access)
-- must not reveal a person's Loves or Priority Watch Stamps.

create or replace function public.can_view_media_reaction(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.profile_is_active(auth.uid())
    and public.profile_is_active(target_user_id)
    and (
      target_user_id = auth.uid()
      or public.are_friends(target_user_id)
      or public.shares_club_with(target_user_id)
    );
$$;

revoke all on function public.can_view_media_reaction(uuid) from public, anon;
grant execute on function public.can_view_media_reaction(uuid) to authenticated;

notify pgrst, 'reload schema';
