-- An owner-controlled marker for media the collection owner owns.
alter table public.media_items
  add column if not exists owned boolean not null default false;

create or replace function public.enforce_media_owned_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owned is distinct from old.owned
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
    raise exception 'Only the active collection owner can change owned status.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists media_items_enforce_owned_owner on public.media_items;
create trigger media_items_enforce_owned_owner
before update of owned on public.media_items
for each row execute function public.enforce_media_owned_owner();

revoke all on function public.enforce_media_owned_owner() from public;
