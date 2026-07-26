-- Custom libraries: Collection -> Library -> Shelf -> Media item.
-- This migration is additive and idempotent. Existing section/type columns are
-- retained as compatibility data for providers, imports and older clients.

do $$ begin
  create type public.library_type as enum ('screen', 'book', 'game', 'other');
exception when duplicate_object then null;
end $$;

create table if not exists public.libraries (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  name text not null,
  type public.library_type not null,
  is_protected boolean not null default false,
  position numeric(12, 6) not null default 1000,
  item_term_singular text not null,
  item_term_plural text not null,
  creator_term text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint libraries_name_length check (char_length(trim(name)) between 1 and 50),
  constraint libraries_singular_length check (char_length(trim(item_term_singular)) between 1 and 40),
  constraint libraries_plural_length check (char_length(trim(item_term_plural)) between 1 and 40),
  constraint libraries_creator_length check (char_length(trim(creator_term)) between 1 and 40),
  unique (id, collection_id)
);

create unique index if not exists libraries_active_name_lower_key
  on public.libraries(collection_id, lower(trim(name))) where deleted_at is null;
create unique index if not exists libraries_one_protected_type_key
  on public.libraries(collection_id, type) where is_protected;
create index if not exists libraries_collection_order_idx
  on public.libraries(collection_id, is_protected desc, position, created_at, id);

create or replace function public.library_defaults(target_type public.library_type)
returns jsonb language sql immutable set search_path=public as $$
  select case target_type
    when 'screen' then jsonb_build_object('name','Film & TV','singular','Title','plural','Titles','creator','Director','position',1000)
    when 'book' then jsonb_build_object('name','Books','singular','Book','plural','Books','creator','Author','position',2000)
    when 'game' then jsonb_build_object('name','Video Games','singular','Game','plural','Games','creator','Developer','position',3000)
    else jsonb_build_object('name','Other','singular','Item','plural','Items','creator','Creator','position',4000)
  end;
$$;

create or replace function public.ensure_default_libraries(target_collection_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare target_type public.library_type; defaults jsonb;
begin
  foreach target_type in array array['screen','book','game']::public.library_type[] loop
    defaults := public.library_defaults(target_type);
    insert into public.libraries(
      collection_id, name, type, is_protected, position,
      item_term_singular, item_term_plural, creator_term
    ) values (
      target_collection_id, defaults->>'name', target_type, true,
      (defaults->>'position')::numeric, defaults->>'singular',
      defaults->>'plural', defaults->>'creator'
    ) on conflict (collection_id, type) where is_protected do nothing;
  end loop;
end;
$$;

do $$ declare collection_row record;
begin
  for collection_row in select id from public.collections loop
    perform public.ensure_default_libraries(collection_row.id);
  end loop;
end $$;

alter table public.shelves add column if not exists library_id uuid;
alter table public.media_items add column if not exists library_id uuid;

update public.shelves shelf
set library_id = library.id
from public.libraries library
where shelf.library_id is null
  and library.collection_id = shelf.collection_id
  and library.is_protected
  and library.type = shelf.section::text::public.library_type;

update public.media_items item
set library_id = library.id
from public.libraries library
where item.library_id is null
  and library.collection_id = item.collection_id
  and library.is_protected
  and library.type = case item.type
    when 'film' then 'screen'::public.library_type
    when 'television' then 'screen'::public.library_type
    when 'book' then 'book'::public.library_type
    when 'game' then 'game'::public.library_type
    else 'other'::public.library_type
  end;

alter table public.shelves alter column library_id set not null;
alter table public.media_items alter column library_id set not null;

do $$ begin
  alter table public.shelves add constraint shelves_library_collection_fk
    foreign key (library_id, collection_id)
    references public.libraries(id, collection_id) on delete restrict;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.media_items add constraint media_items_library_collection_fk
    foreign key (library_id, collection_id)
    references public.libraries(id, collection_id) on delete restrict;
exception when duplicate_object then null;
end $$;

alter table public.shelves drop constraint if exists shelves_collection_id_section_name_key;
create unique index if not exists shelves_active_library_name_lower_key
  on public.shelves(library_id, lower(trim(name))) where deleted_at is null;
create index if not exists shelves_library_position_idx on public.shelves(library_id, position);
create index if not exists media_items_library_created_idx on public.media_items(library_id, created_at, id);

create or replace function public.prepare_library()
returns trigger language plpgsql set search_path=public as $$
declare defaults jsonb;
begin
  new.name := trim(new.name);
  new.item_term_singular := trim(new.item_term_singular);
  new.item_term_plural := trim(new.item_term_plural);
  new.creator_term := trim(new.creator_term);
  if new.position is null then
    select coalesce(max(position), 0) + 1000 into new.position
    from public.libraries where collection_id = new.collection_id;
  end if;
  if tg_op = 'UPDATE' and old.is_protected then
    if not new.is_protected or new.type <> old.type or new.collection_id <> old.collection_id
      or new.deleted_at is not null then
      raise exception 'Default libraries cannot change type, move, or be deleted';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.type <> old.type and exists (
    select 1 from public.shelves where library_id=old.id
    union all select 1 from public.media_items where library_id=old.id
  ) then
    raise exception 'Only a library that has never contained a shelf or item can change type';
  end if;
  if new.type <> 'screen' then
    update public.shelves set show_in_main_watchlist=false
    where library_id=new.id and show_in_main_watchlist;
  end if;
  return new;
end;
$$;

drop trigger if exists libraries_prepare on public.libraries;
create trigger libraries_prepare before insert or update on public.libraries
for each row execute function public.prepare_library();
drop trigger if exists libraries_set_updated_at on public.libraries;
create trigger libraries_set_updated_at before update on public.libraries
for each row execute function public.set_updated_at();

create or replace function public.protect_library_delete()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.is_protected then raise exception 'Default libraries cannot be deleted'; end if;
  return old;
end;
$$;
drop trigger if exists libraries_protect_delete on public.libraries;
create trigger libraries_protect_delete before delete on public.libraries
for each row execute function public.protect_library_delete();

create or replace function public.prepare_library_shelf()
returns trigger language plpgsql set search_path=public as $$
declare destination public.libraries;
begin
  if new.library_id is null then
    select id into new.library_id from public.libraries
    where collection_id=new.collection_id and is_protected and type=new.section::text::public.library_type;
  end if;
  select * into destination from public.libraries where id=new.library_id;
  if not found or destination.collection_id <> new.collection_id then
    raise exception 'Shelf and library must belong to the same collection';
  end if;
  if destination.deleted_at is not null then raise exception 'Deleted libraries cannot receive shelves'; end if;
  new.section := case destination.type
    when 'screen' then 'screen'::public.media_section
    when 'book' then 'book'::public.media_section
    when 'game' then 'game'::public.media_section
    else coalesce(new.section, 'screen'::public.media_section)
  end;
  if destination.type <> 'screen' then new.show_in_main_watchlist := false; end if;
  if tg_op='INSERT' and new.show_in_main_watchlist is null then new.show_in_main_watchlist := false; end if;
  return new;
end;
$$;
drop trigger if exists shelves_prepare_library on public.shelves;
create trigger shelves_prepare_library before insert or update of library_id,collection_id,section,show_in_main_watchlist
on public.shelves for each row execute function public.prepare_library_shelf();

create or replace function public.prepare_library_media()
returns trigger language plpgsql set search_path=public as $$
declare destination public.libraries; expected public.library_type;
begin
  if new.library_id is null then
    expected := case new.type
      when 'film' then 'screen'::public.library_type when 'television' then 'screen'::public.library_type
      when 'book' then 'book'::public.library_type when 'game' then 'game'::public.library_type
      else 'other'::public.library_type end;
    select id into new.library_id from public.libraries
    where collection_id=new.collection_id and is_protected and type=expected;
  end if;
  select * into destination from public.libraries where id=new.library_id;
  if not found or destination.collection_id <> new.collection_id then
    raise exception 'Item and library must belong to the same collection';
  end if;
  if destination.deleted_at is not null then raise exception 'Deleted libraries cannot receive items'; end if;
  expected := case new.type
    when 'film' then 'screen'::public.library_type
    when 'television' then 'screen'::public.library_type
    when 'book' then 'book'::public.library_type
    when 'game' then 'game'::public.library_type
    else 'other'::public.library_type
  end;
  if destination.type <> expected then raise exception 'Item type must match its library type'; end if;
  return new;
end;
$$;
drop trigger if exists media_items_prepare_library on public.media_items;
create trigger media_items_prepare_library before insert or update of library_id,collection_id,type
on public.media_items for each row execute function public.prepare_library_media();

create or replace function public.valid_shelf_membership()
returns trigger language plpgsql set search_path=public as $$
begin
  if not exists (
    select 1 from public.shelves shelf
    join public.media_items item on item.id=new.media_item_id
    join public.libraries library on library.id=shelf.library_id
    where shelf.id=new.shelf_id
      and shelf.collection_id=item.collection_id
      and shelf.library_id=item.library_id
      and library.deleted_at is null
  ) then raise exception 'Media item and shelf must belong to the same active library'; end if;
  return new;
end;
$$;

create or replace function public.enforce_library_watchlist()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.show_in_main_watchlist and not exists (
    select 1 from public.libraries where id=new.library_id and type='screen' and deleted_at is null
  ) then raise exception 'Only active Film & TV library shelves can contribute to Main Watchlist'; end if;
  return new;
end;
$$;
drop trigger if exists shelves_enforce_library_watchlist on public.shelves;
create trigger shelves_enforce_library_watchlist before insert or update of show_in_main_watchlist,library_id
on public.shelves for each row execute function public.enforce_library_watchlist();

create or replace function public.create_collection_libraries()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.ensure_default_libraries(new.id);
  return new;
end;
$$;
drop trigger if exists a_collections_create_libraries on public.collections;
create trigger a_collections_create_libraries after insert on public.collections
for each row execute function public.create_collection_libraries();

create or replace function public.ensure_collection_watchlist()
returns trigger language plpgsql security definer set search_path=public as $$
declare screen_library uuid;
begin
  perform public.ensure_default_libraries(new.id);
  select id into screen_library from public.libraries
  where collection_id=new.id and type='screen' and is_protected limit 1;
  insert into public.shelves(
    collection_id, library_id, section, name, position, is_required,
    is_queue_list, show_in_main_watchlist, main_watchlist_position
  ) values (new.id, screen_library, 'screen', 'Watchlist', 1000, true, true, true, null)
  on conflict (library_id, lower(trim(name))) where deleted_at is null do update
    set is_required=true, is_queue_list=true, show_in_main_watchlist=true, deleted_at=null;
  return new;
end;
$$;

-- Re-create approval so a newly approved member receives exactly three
-- protected libraries while preserving the existing starter shelves.
create or replace function public.approve_profile(target_profile_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare slug_value text; collection_value uuid; screen_library uuid; book_library uuid; game_library uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.profiles set approved_at=coalesce(approved_at,now()), rejected_at=null,
    approved_by=auth.uid(), rejected_by=null where id=target_profile_id;
  select lower(regexp_replace(username,'[^a-z0-9-]+','-','g')) || '-collection'
    into slug_value from public.profiles where id=target_profile_id;
  insert into public.collections(owner_id,title,slug)
    select id,display_name || '''s Collection',slug_value from public.profiles where id=target_profile_id
    on conflict(owner_id) do nothing;
  select id into collection_value from public.collections where owner_id=target_profile_id;
  perform public.ensure_default_libraries(collection_value);
  select id into screen_library from public.libraries where collection_id=collection_value and type='screen' and is_protected;
  select id into book_library from public.libraries where collection_id=collection_value and type='book' and is_protected;
  select id into game_library from public.libraries where collection_id=collection_value and type='game' and is_protected;
  insert into public.shelves(collection_id,library_id,section,name,position,is_required,is_reading_list,is_queue_list)
  select collection_value, v.library_id, v.section, v.name, v.position, v.required, v.reading, v.queue from (values
    (screen_library,'screen'::public.media_section,'Watchlist',1000,true,false,true),
    (screen_library,'screen'::public.media_section,'Owned',2000,false,false,false),
    (book_library,'book'::public.media_section,'Reading List',1000,false,true,true),
    (book_library,'book'::public.media_section,'Currently Reading',2000,false,true,true),
    (book_library,'book'::public.media_section,'Owned',3000,false,false,false),
    (book_library,'book'::public.media_section,'Wishlist',4000,false,false,false),
    (game_library,'game'::public.media_section,'RPG',1000,false,false,false),
    (game_library,'game'::public.media_section,'Action & Adventure',2000,false,false,false),
    (game_library,'game'::public.media_section,'Building & Puzzle',3000,false,false,false),
    (game_library,'game'::public.media_section,'Strategy',4000,false,false,false)
  ) v(library_id,section,name,position,required,reading,queue)
  on conflict (library_id, lower(trim(name))) where deleted_at is null do update set
    is_required=public.shelves.is_required or excluded.is_required,
    is_reading_list=public.shelves.is_reading_list or excluded.is_reading_list,
    is_queue_list=public.shelves.is_queue_list or excluded.is_queue_list;
end;
$$;

alter table public.libraries enable row level security;
revoke all on public.libraries from public, anon, authenticated;
drop policy if exists "Visible libraries can be read" on public.libraries;
create policy "Visible libraries can be read" on public.libraries for select
using ((deleted_at is null and public.can_view_collection(collection_id)) or public.can_manage_collection(collection_id));
drop policy if exists "Owners and admins can create libraries" on public.libraries;
create policy "Owners and admins can create libraries" on public.libraries for insert to authenticated
with check (public.can_manage_collection(collection_id) and not is_protected);
drop policy if exists "Owners and admins can update libraries" on public.libraries;
create policy "Owners and admins can update libraries" on public.libraries for update to authenticated
using (public.can_manage_collection(collection_id)) with check (public.can_manage_collection(collection_id));
drop policy if exists "Owners and admins can delete libraries" on public.libraries;
create policy "Owners and admins can delete libraries" on public.libraries for delete to authenticated
using (public.can_manage_collection(collection_id) and not is_protected);
grant select,insert,update,delete on public.libraries to authenticated;
grant select on public.libraries to anon;

drop policy if exists "Club members can read shelves" on public.shelves;
create policy "Club members can read shelves" on public.shelves for select
using (
  public.can_manage_collection(collection_id) or (
    deleted_at is null and public.can_view_collection(collection_id)
    and exists (select 1 from public.libraries l where l.id=library_id and l.deleted_at is null)
  )
);
drop policy if exists "Club members can read media" on public.media_items;
create policy "Club members can read media" on public.media_items for select
using (
  public.can_manage_collection(collection_id) or (
    deleted_at is null and public.can_view_collection(collection_id)
    and exists (select 1 from public.libraries l where l.id=library_id and l.deleted_at is null)
  )
);

create or replace function public.load_collection_library(target_collection_id uuid, target_library_id uuid default null)
returns jsonb language sql stable security definer set search_path=public as $$
  with visible_collection as materialized (
    select c.* from public.collections c where c.id=target_collection_id and public.can_view_collection(c.id) limit 1
  ), active_libraries as materialized (
    select l.* from public.libraries l join visible_collection c on c.id=l.collection_id
    where l.deleted_at is null
  ), chosen as materialized (
    select l.* from active_libraries l
    order by (l.id=target_library_id) desc,
      (l.is_protected and l.type='screen') desc, l.is_protected desc, l.position, l.created_at, l.id limit 1
  ), library_shelves as materialized (
    select s.* from public.shelves s join chosen l on l.id=s.library_id
  ), library_media as materialized (
    select m.* from public.media_items m join chosen l on l.id=m.library_id
  ), memberships as materialized (
    select sm.* from public.shelf_media_items sm
    join library_shelves s on s.id=sm.shelf_id
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
      select 1 from interests i where i.user_id=p.id union all select 1 from reactions r where r.user_id=p.id
    )),'[]'::jsonb)
  ) end;
$$;

create or replace function public.sanitized_collection_library_snapshot(target_collection_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'collection',jsonb_build_object(
      'id',c.id,'owner_id',c.owner_id,'title',c.title,'description',c.description,
      'book_description',c.book_description,'game_description',c.game_description,'updated_at',c.updated_at
    ),
    'libraries',coalesce((select jsonb_agg(to_jsonb(l) order by l.is_protected desc,l.position,l.created_at,l.id)
      from public.libraries l where l.collection_id=c.id and l.deleted_at is null),'[]'::jsonb),
    'shelves',coalesce((select jsonb_agg(to_jsonb(s) order by s.library_id,s.position,s.id)
      from public.shelves s join public.libraries l on l.id=s.library_id and l.deleted_at is null
      where s.collection_id=c.id and s.deleted_at is null),'[]'::jsonb),
    'media',coalesce((select jsonb_agg(to_jsonb(m) order by m.library_id,m.created_at,m.id)
      from public.media_items m join public.libraries l on l.id=m.library_id and l.deleted_at is null
      where m.collection_id=c.id and m.deleted_at is null),'[]'::jsonb),
    'memberships',coalesce((select jsonb_agg(to_jsonb(sm) order by sm.shelf_id,sm.position,sm.media_item_id)
      from public.shelf_media_items sm
      join public.shelves s on s.id=sm.shelf_id and s.collection_id=c.id and s.deleted_at is null
      join public.media_items m on m.id=sm.media_item_id and m.collection_id=c.id and m.deleted_at is null
      join public.libraries l on l.id=s.library_id and l.id=m.library_id and l.deleted_at is null),'[]'::jsonb)
  ) from public.collections c where c.id=target_collection_id;
$$;

create or replace function public.get_shared_collection(share_token text)
returns jsonb language sql stable security definer set search_path=public as $$
  select public.sanitized_collection_library_snapshot(link.collection_id)
  from public.collection_share_links link
  join public.collections c on c.id=link.collection_id
  join public.profiles p on p.id=c.owner_id
  where link.token=share_token and link.enabled
    and p.approved_at is not null and p.rejected_at is null and p.deactivated_at is null;
$$;

create or replace function public.get_public_collection_by_username(public_username text)
returns jsonb language sql stable security definer set search_path=public as $$
  select public.sanitized_collection_library_snapshot(c.id)
  from public.profiles p join public.collections c on c.owner_id=p.id
  where lower(p.username)=lower(trim(public_username)) and p.public_collection_enabled
    and p.approved_at is not null and p.rejected_at is null and p.deactivated_at is null
  order by c.created_at limit 1;
$$;

create or replace function public.reorder_library_shelves(target_library_id uuid, ordered_shelf_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
declare target_collection uuid;
begin
  select collection_id into target_collection from public.libraries where id=target_library_id and deleted_at is null;
  if target_collection is null or not public.can_manage_collection(target_collection) then raise exception 'Library access required'; end if;
  if exists(select 1 from unnest(ordered_shelf_ids) id group by id having count(*)>1) then raise exception 'Duplicate shelf id'; end if;
  if (select count(*) from public.shelves where library_id=target_library_id and deleted_at is null)
    <> coalesce(array_length(ordered_shelf_ids,1),0) then raise exception 'Order must include every active shelf'; end if;
  if exists(select 1 from unnest(ordered_shelf_ids) id where not exists(
    select 1 from public.shelves where shelves.id=id and library_id=target_library_id and deleted_at is null
  )) then raise exception 'Shelf is outside this library'; end if;
  update public.shelves s set position=ranked.position
  from (select id,ordinality*1000 position from unnest(ordered_shelf_ids) with ordinality u(id,ordinality)) ranked
  where s.id=ranked.id;
end;
$$;

create or replace function public.bulk_import_media_to_shelves(
  target_collection_id uuid, target_shelf_ids uuid[], target_section public.media_section, import_items jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare entry jsonb; item_title text; item_type public.media_type; created_id uuid;
  target_shelf_id uuid; target_library uuid; imported_count integer:=0; skipped_count integer:=0;
begin
  if jsonb_typeof(import_items)<>'array' or jsonb_array_length(import_items)=0 then raise exception 'Import must contain at least one item'; end if;
  if jsonb_array_length(import_items)>250 then raise exception 'A single import is limited to 250 items'; end if;
  if coalesce(cardinality(target_shelf_ids),0)=0 then raise exception 'Choose at least one shelf'; end if;
  if cardinality(target_shelf_ids)<>(select count(distinct id) from unnest(target_shelf_ids) selected(id)) then raise exception 'A shelf can only be selected once'; end if;
  if not public.owns_active_collection(target_collection_id) then raise exception 'Only the active collection owner can import media'; end if;
  select library_id into target_library from public.shelves where id=target_shelf_ids[1] and deleted_at is null;
  if target_library is null or exists(select 1 from unnest(target_shelf_ids) selected(id) where not exists(
    select 1 from public.shelves s where s.id=selected.id and s.collection_id=target_collection_id
      and s.library_id=target_library and s.deleted_at is null
  )) then raise exception 'Every selected shelf must belong to the same active library'; end if;
  for entry in select value from jsonb_array_elements(import_items) loop
    item_title:=trim(entry->>'title');
    begin item_type:=(entry->>'type')::public.media_type; exception when others then raise exception 'Invalid media type in import'; end;
    if item_title is null or item_title='' then raise exception 'Every imported item needs a title'; end if;
    if not exists(select 1 from public.libraries l where l.id=target_library and (
      (l.type='screen' and item_type in ('film','television')) or l.type::text=item_type::text
    )) then raise exception 'Import contains a media type outside the destination library'; end if;
    if exists(select 1 from public.media_items m where m.library_id=target_library and m.type=item_type
      and lower(trim(m.title))=lower(item_title) and m.deleted_at is null) then skipped_count:=skipped_count+1; continue; end if;
    insert into public.media_items(collection_id,library_id,type,title,platforms,genres)
      values(target_collection_id,target_library,item_type,item_title,'{}','{}') returning id into created_id;
    foreach target_shelf_id in array target_shelf_ids loop
      insert into public.shelf_media_items(shelf_id,media_item_id,position) values(
        target_shelf_id,created_id,coalesce((select max(position) from public.shelf_media_items where shelf_id=target_shelf_id),0)+1000
      );
    end loop;
    imported_count:=imported_count+1;
  end loop;
  return jsonb_build_object('imported',imported_count,'skipped',skipped_count);
end;
$$;

create or replace function public.clone_media_to_library(
  source_media_id uuid, destination_library uuid, include_private boolean, preserve_deleted boolean default false
)
returns uuid language plpgsql security definer set search_path=public as $$
declare copied_id uuid; destination_collection uuid; source public.media_items;
begin
  select * into source from public.media_items where id=source_media_id;
  if not found then raise exception 'Source item is unavailable'; end if;
  select collection_id into destination_collection from public.libraries where id=destination_library;
  insert into public.media_items(
    collection_id,library_id,type,title,year,status,priority,notes,poster_url,creator,director,
    description,format,platforms,genres,rating,star_rating,owned,runtime,external_ids,deleted_at
  ) values (
    destination_collection,destination_library,source.type,source.title,source.year,source.status,
    case when include_private then source.priority else null end,
    case when include_private then source.notes else null end,
    source.poster_url,source.creator,source.director,source.description,source.format,source.platforms,
    source.genres,source.rating,case when include_private then source.star_rating else null end,
    case when include_private then source.owned else false end,source.runtime,source.external_ids,
    case when preserve_deleted then source.deleted_at else null end
  ) returning id into copied_id;
  return copied_id;
end;
$$;

create or replace function public.move_shelf_to_library(source_shelf_id uuid, destination_library_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare source public.shelves; source_library public.libraries; destination public.libraries;
  membership record; copied_id uuid; affected integer:=0;
begin
  select * into source from public.shelves where id=source_shelf_id for update;
  if not found or source.deleted_at is not null then raise exception 'Restore the shelf before moving it'; end if;
  if source.is_required then raise exception 'Protected shelves cannot be moved'; end if;
  if not exists(
    select 1 from public.collections c
    where c.id=source.collection_id and c.owner_id=auth.uid()
  ) then raise exception 'Shelf owner access required'; end if;
  select * into source_library from public.libraries where id=source.library_id;
  select * into destination from public.libraries where id=destination_library_id and deleted_at is null for update;
  if not found or destination.collection_id<>source.collection_id then raise exception 'Choose a library in the same collection'; end if;
  if destination.type<>source_library.type then raise exception 'Shelf moves require the same library type'; end if;
  if destination.id=source.library_id then raise exception 'Choose another library'; end if;
  update public.shelves set library_id=destination.id,
    position=(select coalesce(max(position),0)+1000 from public.shelves where library_id=destination.id)
  where id=source.id;
  for membership in
    select sm.media_item_id,sm.position from public.shelf_media_items sm
    where sm.shelf_id=source.id order by sm.position,sm.media_item_id
  loop
    affected:=affected+1;
    if exists(select 1 from public.shelf_media_items other
      join public.shelves os on os.id=other.shelf_id
      where other.media_item_id=membership.media_item_id and other.shelf_id<>source.id
        and os.library_id=source.library_id) then
      copied_id:=public.clone_media_to_library(membership.media_item_id,destination.id,true,true);
      update public.shelf_media_items set media_item_id=copied_id
      where shelf_id=source.id and media_item_id=membership.media_item_id;
    else
      update public.media_items set library_id=destination.id where id=membership.media_item_id;
    end if;
  end loop;
  return jsonb_build_object('shelf_id',source.id,'library_id',destination.id,'item_count',affected);
end;
$$;

create or replace function public.copy_shelf_to_library(
  source_shelf_id uuid, destination_library_id uuid, destination_name text, share_token text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare source public.shelves; source_library public.libraries; destination public.libraries;
  source_owner uuid; destination_owner uuid;
  copied_shelf uuid; membership record; copied_media uuid; affected integer:=0; include_private boolean;
begin
  if not public.profile_is_active(auth.uid()) then raise exception 'Approved active account required'; end if;
  select s.* into source from public.shelves s join public.libraries l on l.id=s.library_id
    where s.id=source_shelf_id and s.deleted_at is null and l.deleted_at is null;
  if not found then raise exception 'Source shelf is unavailable'; end if;
  select * into source_library from public.libraries where id=source.library_id;
  select * into destination from public.libraries where id=destination_library_id and deleted_at is null for update;
  if not found then raise exception 'Destination library is unavailable'; end if;
  select owner_id into source_owner from public.collections where id=source.collection_id;
  select owner_id into destination_owner from public.collections where id=destination.collection_id;
  if destination_owner<>auth.uid() then raise exception 'You must own the destination library'; end if;
  if destination.type<>source_library.type then raise exception 'Shelf copies require the same library type'; end if;
  include_private:=source_owner=auth.uid();
  if not include_private and not (
    public.can_view_collection(source.collection_id) or exists(
      select 1 from public.collection_share_links link
      where link.collection_id=source.collection_id and link.enabled and link.token=share_token
    ) or exists(
      select 1 from public.collections c join public.profiles p on p.id=c.owner_id
      where c.id=source.collection_id and p.public_collection_enabled
        and p.approved_at is not null and p.rejected_at is null and p.deactivated_at is null
    )
  ) then raise exception 'Source collection access is required'; end if;
  insert into public.shelves(
    collection_id,library_id,section,name,subtitle,is_queue_list,is_reading_list,is_numbered,
    position,is_required,show_in_main_watchlist,main_watchlist_position
  ) values (
    destination.collection_id,destination.id,source.section,trim(destination_name),source.subtitle,
    source.is_queue_list,source.is_reading_list,source.is_numbered,
    (select coalesce(max(position),0)+1000 from public.shelves where library_id=destination.id),
    false,false,null
  ) returning id into copied_shelf;
  for membership in select sm.media_item_id,sm.position from public.shelf_media_items sm
    join public.media_items m on m.id=sm.media_item_id
    where sm.shelf_id=source.id and m.deleted_at is null order by sm.position,sm.media_item_id
  loop
    affected:=affected+1;
    copied_media:=public.clone_media_to_library(membership.media_item_id,destination.id,include_private,false);
    insert into public.shelf_media_items(shelf_id,media_item_id,position)
      values(copied_shelf,copied_media,membership.position);
  end loop;
  return jsonb_build_object('shelf_id',copied_shelf,'library_id',destination.id,'collection_id',destination.collection_id,'item_count',affected);
end;
$$;

revoke all on function public.library_defaults(public.library_type) from public;
revoke all on function public.ensure_default_libraries(uuid) from public;
revoke all on function public.prepare_library() from public;
revoke all on function public.protect_library_delete() from public;
revoke all on function public.prepare_library_shelf() from public;
revoke all on function public.prepare_library_media() from public;
revoke all on function public.enforce_library_watchlist() from public;
revoke all on function public.create_collection_libraries() from public;
revoke all on function public.clone_media_to_library(uuid,uuid,boolean,boolean) from public;
revoke all on function public.load_collection_library(uuid,uuid) from public;
revoke all on function public.sanitized_collection_library_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.reorder_library_shelves(uuid,uuid[]) from public;
revoke all on function public.move_shelf_to_library(uuid,uuid) from public;
revoke all on function public.copy_shelf_to_library(uuid,uuid,text,text) from public;
grant execute on function public.load_collection_library(uuid,uuid) to anon,authenticated;
grant execute on function public.reorder_library_shelves(uuid,uuid[]) to authenticated;
grant execute on function public.move_shelf_to_library(uuid,uuid) to authenticated;
grant execute on function public.copy_shelf_to_library(uuid,uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
