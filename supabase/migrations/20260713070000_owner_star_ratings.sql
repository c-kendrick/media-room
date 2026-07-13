-- Five-star ratings belong to the collection owner and use half-star increments.
alter table public.media_items
  add column if not exists star_rating numeric(2, 1);

alter table public.media_items
  drop constraint if exists media_items_star_rating_range;

alter table public.media_items
  add constraint media_items_star_rating_range check (
    star_rating is null
    or (
      star_rating between 0.5 and 5
      and star_rating * 2 = trunc(star_rating * 2)
    )
  );

create or replace function public.enforce_media_star_rating_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.star_rating is distinct from old.star_rating
    and coalesce(auth.role(), '') <> 'service_role'
    and not exists (
      select 1
      from public.collections c
      join public.profiles p on p.id = c.owner_id
      where c.id = new.collection_id
        and c.owner_id = auth.uid()
        and p.approved_at is not null
        and p.rejected_at is null
        and p.deactivated_at is null
    )
  then
    raise exception 'Only the active collection owner can change a star rating.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists media_items_enforce_star_rating_owner on public.media_items;
create trigger media_items_enforce_star_rating_owner
before update of star_rating on public.media_items
for each row execute function public.enforce_media_star_rating_owner();

revoke all on function public.enforce_media_star_rating_owner() from public;
