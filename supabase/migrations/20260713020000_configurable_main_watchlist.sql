-- Configurable mirrored shelves and editable collection introductions.

alter table public.collections
  add column if not exists description text;

alter table public.shelves
  add column if not exists show_in_main_watchlist boolean not null default false;

alter table public.shelves
  add column if not exists main_watchlist_position numeric(12, 6);

update public.collections
set description = 'A living collection of films, television, books and games.'
where description is null;

update public.shelves
set show_in_main_watchlist = true
where section = 'screen'
  and lower(trim(name)) = 'watchlist'
  and deleted_at is null;

with ranked as (
  select s.id, row_number() over (order by c.title, s.position, s.id) * 1000 as next_position
  from public.shelves s
  join public.collections c on c.id = s.collection_id
  where s.show_in_main_watchlist and s.deleted_at is null
)
update public.shelves s
set main_watchlist_position = ranked.next_position
from ranked
where s.id = ranked.id and s.main_watchlist_position is null;

create or replace function public.assign_main_watchlist_position()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.show_in_main_watchlist and new.main_watchlist_position is null then
    select coalesce(max(main_watchlist_position), 0) + 1000
    into new.main_watchlist_position
    from public.shelves
    where show_in_main_watchlist and deleted_at is null;
  end if;
  return new;
end $$;

drop trigger if exists shelves_assign_main_watchlist_position on public.shelves;
create trigger shelves_assign_main_watchlist_position
before insert or update of show_in_main_watchlist on public.shelves
for each row execute function public.assign_main_watchlist_position();

create or replace function public.ensure_collection_watchlist()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.shelves (collection_id, section, name, position, is_required, show_in_main_watchlist, main_watchlist_position)
  values (new.id, 'screen', 'Watchlist', 1000, true, true, null)
  on conflict (collection_id, section, name) do update
    set is_required = true, show_in_main_watchlist = true, deleted_at = null;
  return new;
end $$;

drop trigger if exists collections_create_watchlist on public.collections;
create trigger collections_create_watchlist
after insert on public.collections
for each row execute function public.ensure_collection_watchlist();

create or replace function public.reorder_main_watchlist(ordered_shelf_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if exists (select 1 from unnest(ordered_shelf_ids) id group by id having count(*) > 1) then raise exception 'Duplicate shelf id'; end if;
  if (select count(*) from public.shelves where show_in_main_watchlist and deleted_at is null) <> coalesce(array_length(ordered_shelf_ids, 1), 0) then
    raise exception 'Order must include every Main Watchlist shelf';
  end if;
  if exists (
    select 1 from unnest(ordered_shelf_ids) id
    where not exists (select 1 from public.shelves s where s.id=id and s.show_in_main_watchlist and s.deleted_at is null)
  ) then raise exception 'Shelf is not included in Main Watchlist'; end if;
  update public.shelves s set main_watchlist_position = ranked.position
  from (select id, ordinality * 1000 as position from unnest(ordered_shelf_ids) with ordinality u(id, ordinality)) ranked
  where s.id=ranked.id;
end $$;

revoke all on function public.assign_main_watchlist_position() from public;
revoke all on function public.ensure_collection_watchlist() from public;
revoke all on function public.reorder_main_watchlist(uuid[]) from public;
grant execute on function public.reorder_main_watchlist(uuid[]) to authenticated;
