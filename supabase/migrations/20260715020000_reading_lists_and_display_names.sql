-- Explicit book reading-list shelves and complete display-name propagation.

alter table public.shelves
  add column if not exists is_reading_list boolean not null default false;

update public.shelves
set is_reading_list = true
where section = 'book'
  and lower(trim(name)) in ('reading list', 'currently reading');

insert into public.shelves (collection_id, section, name, position, is_reading_list)
select id, 'book'::public.media_section, 'Reading List', 500, true
from public.collections
on conflict (collection_id, section, name) do update set
  is_reading_list = true,
  deleted_at = null;

create or replace function public.update_own_display_name(new_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_name text := trim(coalesce(new_display_name, ''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(cleaned_name) < 2 or char_length(cleaned_name) > 80 then
    raise exception 'Display name must be between 2 and 80 characters';
  end if;

  update public.profiles set display_name = cleaned_name where id = auth.uid();
  if not found then raise exception 'Profile not found'; end if;

  update public.collections
  set title = cleaned_name || '’s Collection'
  where owner_id = auth.uid();
end;
$$;

create or replace function public.approve_profile(target_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare slug_value text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.profiles set approved_at=coalesce(approved_at, now()), rejected_at=null, approved_by=auth.uid(), rejected_by=null where id=target_profile_id;
  select lower(regexp_replace(username, '[^a-z0-9-]+', '-', 'g')) || '-collection' into slug_value from public.profiles where id=target_profile_id;
  insert into public.collections (owner_id,title,slug) select id, display_name || '’s Collection', slug_value from public.profiles where id=target_profile_id on conflict (owner_id) do nothing;
  insert into public.shelves (collection_id,section,name,position,is_required,is_reading_list)
  select c.id, v.section::public.media_section, v.name, v.position, v.is_required, v.is_reading_list from public.collections c cross join (values
    ('screen','Watchlist',1000,true,false),('screen','Owned',2000,false,false),
    ('book','Reading List',1000,false,true),('book','Currently Reading',2000,false,true),('book','Owned',3000,false,false),('book','Wishlist',4000,false,false),
    ('game','RPG',1000,false,false),('game','Action & Adventure',2000,false,false),('game','Building & Puzzle',3000,false,false),('game','Strategy',4000,false,false)
  ) as v(section,name,position,is_required,is_reading_list) where c.owner_id=target_profile_id
  on conflict (collection_id,section,name) do update set
    is_required=public.shelves.is_required or excluded.is_required,
    is_reading_list=public.shelves.is_reading_list or excluded.is_reading_list;
end $$;

revoke all on function public.update_own_display_name(text) from public;
grant execute on function public.update_own_display_name(text) to authenticated;

notify pgrst, 'reload schema';
