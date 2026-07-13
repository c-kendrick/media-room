-- Persistent, admin-managed collection order for navigation and owner groups.

alter table public.collections
  add column if not exists position numeric(12, 6);

with ranked as (
  select id, row_number() over (order by title, id) * 1000 as next_position
  from public.collections
)
update public.collections c
set position = ranked.next_position
from ranked
where c.id = ranked.id and c.position is null;

create or replace function public.assign_collection_position()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.position is null then
    select coalesce(max(position), 0) + 1000 into new.position from public.collections;
  end if;
  return new;
end $$;

drop trigger if exists collections_assign_position on public.collections;
create trigger collections_assign_position
before insert on public.collections
for each row execute function public.assign_collection_position();

alter table public.collections
  alter column position set not null;

create index if not exists collections_position_idx on public.collections (position, title);

create or replace function public.reorder_collections(ordered_collection_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if exists (select 1 from unnest(ordered_collection_ids) id group by id having count(*) > 1) then
    raise exception 'Duplicate collection id';
  end if;
  if (select count(*) from public.collections) <> coalesce(array_length(ordered_collection_ids, 1), 0) then
    raise exception 'Order must include every active collection';
  end if;
  if exists (
    select 1 from unnest(ordered_collection_ids) id
    where not exists (select 1 from public.collections c where c.id = id)
  ) then raise exception 'Unknown collection'; end if;

  update public.collections c set position = ranked.position
  from (
    select id, ordinality * 1000 as position
    from unnest(ordered_collection_ids) with ordinality u(id, ordinality)
  ) ranked
  where c.id = ranked.id;
end $$;

revoke all on function public.assign_collection_position() from public;
revoke all on function public.reorder_collections(uuid[]) from public;
grant execute on function public.reorder_collections(uuid[]) to authenticated;
