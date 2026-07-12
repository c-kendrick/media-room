-- Registration approval and idempotent default collection creation.
create or replace function public.approve_profile(target_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare slug_value text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.profiles set approved_at=coalesce(approved_at, now()), rejected_at=null, approved_by=auth.uid(), rejected_by=null where id=target_profile_id;
  select lower(regexp_replace(username, '[^a-z0-9-]+', '-', 'g')) || '-collection' into slug_value from public.profiles where id=target_profile_id;
  insert into public.collections (owner_id,title,slug) select id, display_name || '’s Collection', slug_value from public.profiles where id=target_profile_id on conflict (owner_id) do nothing;
  insert into public.shelves (collection_id,section,name,position)
  select c.id, v.section::public.media_section, v.name, v.position from public.collections c cross join (values
    ('screen','Watchlist',1000),('screen','Owned',2000),('book','Currently Reading',1000),('book','Owned',2000),('book','Wishlist',3000),
    ('game','RPG',1000),('game','Action & Adventure',2000),('game','Building & Puzzle',3000),('game','Strategy',4000)
  ) as v(section,name,position) where c.owner_id=target_profile_id
  on conflict (collection_id,section,name) do nothing;
end $$;
create or replace function public.reject_profile(target_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin if not public.is_admin() then raise exception 'Admin access required'; end if;
update public.profiles set rejected_at=now(), rejected_by=auth.uid(), approved_at=null, approved_by=null where id=target_profile_id; end $$;
revoke all on function public.approve_profile(uuid) from public;
revoke all on function public.reject_profile(uuid) from public;
grant execute on function public.approve_profile(uuid) to authenticated;
grant execute on function public.reject_profile(uuid) to authenticated;