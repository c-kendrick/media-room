-- Explicit queue shelves for Film & TV, Books, and Video Games.

alter table public.shelves
  add column if not exists is_queue_list boolean not null default false;

-- Preserve settings that were already explicit. The required Film & TV shelf
-- is a system default, not a name-based guess.
update public.shelves
set is_queue_list = true
where is_required = true
   or is_reading_list = true;

create or replace function public.approve_profile(target_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare slug_value text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.profiles set approved_at=coalesce(approved_at, now()), rejected_at=null, approved_by=auth.uid(), rejected_by=null where id=target_profile_id;
  select lower(regexp_replace(username, '[^a-z0-9-]+', '-', 'g')) || '-collection' into slug_value from public.profiles where id=target_profile_id;
  insert into public.collections (owner_id,title,slug) select id, display_name || 'â€™s Collection', slug_value from public.profiles where id=target_profile_id on conflict (owner_id) do nothing;
  insert into public.shelves (collection_id,section,name,position,is_required,is_reading_list,is_queue_list)
  select c.id, v.section::public.media_section, v.name, v.position, v.is_required, v.is_reading_list, v.is_queue_list from public.collections c cross join (values
    ('screen','Watchlist',1000,true,false,true),('screen','Owned',2000,false,false,false),
    ('book','Reading List',1000,false,true,true),('book','Currently Reading',2000,false,true,true),('book','Owned',3000,false,false,false),('book','Wishlist',4000,false,false,false),
    ('game','RPG',1000,false,false,false),('game','Action & Adventure',2000,false,false,false),('game','Building & Puzzle',3000,false,false,false),('game','Strategy',4000,false,false,false)
  ) as v(section,name,position,is_required,is_reading_list,is_queue_list) where c.owner_id=target_profile_id
  on conflict (collection_id,section,name) do update set
    is_required=public.shelves.is_required or excluded.is_required,
    is_reading_list=public.shelves.is_reading_list or excluded.is_reading_list,
    is_queue_list=public.shelves.is_queue_list or excluded.is_queue_list;
end $$;

notify pgrst, 'reload schema';
