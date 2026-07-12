-- Every approved collection has one canonical Film & TV Watchlist. Main
-- Watchlist reads these original memberships directly, so no media is copied.

alter table public.shelves
  add column if not exists is_required boolean not null default false;

update public.shelves
set name = 'Watchlist', is_required = true, deleted_at = null
where section = 'screen'
  and lower(trim(name)) = 'watchlist';

insert into public.shelves (collection_id, section, name, position, is_required)
select c.id, 'screen'::public.media_section, 'Watchlist', 1000, true
from public.collections c
where not exists (
  select 1 from public.shelves s
  where s.collection_id = c.id
    and s.section = 'screen'
    and lower(trim(s.name)) = 'watchlist'
);

alter table public.shelves
  add constraint shelves_required_watchlist_shape check (
    not is_required or (
      section = 'screen'
      and lower(trim(name)) = 'watchlist'
      and deleted_at is null
    )
  );

create unique index shelves_one_required_watchlist_per_collection
  on public.shelves (collection_id)
  where is_required;

create or replace function public.ensure_collection_watchlist()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.shelves (collection_id, section, name, position, is_required)
  values (new.id, 'screen', 'Watchlist', 1000, true)
  on conflict (collection_id, section, name) do update
    set is_required = true, deleted_at = null;
  return new;
end $$;

drop trigger if exists collections_create_watchlist on public.collections;
create trigger collections_create_watchlist
after insert on public.collections
for each row execute function public.ensure_collection_watchlist();

create or replace function public.protect_required_shelf()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_required then raise exception 'Required shelves cannot be deleted'; end if;
    return old;
  end if;
  if old.is_required and (
    not new.is_required
    or new.section <> 'screen'
    or lower(trim(new.name)) <> 'watchlist'
    or new.deleted_at is not null
  ) then
    raise exception 'The required Watchlist cannot be renamed, moved, or archived';
  end if;
  return new;
end $$;

drop trigger if exists shelves_protect_required on public.shelves;
create trigger shelves_protect_required
before update or delete on public.shelves
for each row execute function public.protect_required_shelf();

revoke all on function public.ensure_collection_watchlist() from public;
revoke all on function public.protect_required_shelf() from public;

-- Re-applying approval repairs the invariant for an existing collection too.
create or replace function public.approve_profile(target_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare slug_value text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.profiles set approved_at=coalesce(approved_at, now()), rejected_at=null, approved_by=auth.uid(), rejected_by=null where id=target_profile_id;
  select lower(regexp_replace(username, '[^a-z0-9-]+', '-', 'g')) || '-collection' into slug_value from public.profiles where id=target_profile_id;
  insert into public.collections (owner_id,title,slug) select id, display_name || '’s Collection', slug_value from public.profiles where id=target_profile_id on conflict (owner_id) do nothing;
  insert into public.shelves (collection_id,section,name,position,is_required)
  select c.id, v.section::public.media_section, v.name, v.position, v.is_required from public.collections c cross join (values
    ('screen','Watchlist',1000,true),('screen','Owned',2000,false),('book','Currently Reading',1000,false),('book','Owned',2000,false),('book','Wishlist',3000,false),
    ('game','RPG',1000,false),('game','Action & Adventure',2000,false),('game','Building & Puzzle',3000,false),('game','Strategy',4000,false)
  ) as v(section,name,position,is_required) where c.owner_id=target_profile_id
  on conflict (collection_id,section,name) do update set is_required=excluded.is_required where excluded.is_required;
end $$;
