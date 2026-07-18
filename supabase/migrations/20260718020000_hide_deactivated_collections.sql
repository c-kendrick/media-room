create or replace function public.can_view_shelf(target_shelf_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.shelves s
    where s.id = target_shelf_id
      and public.can_view_collection(s.collection_id)
      and (s.deleted_at is null or public.can_manage_collection(s.collection_id))
  );
$$;

create or replace function public.can_view_media_item(target_media_item_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.media_items m
    where m.id = target_media_item_id
      and public.can_view_collection(m.collection_id)
      and (m.deleted_at is null or public.can_manage_collection(m.collection_id))
  );
$$;

drop policy if exists "Club members can read collections" on public.collections;
create policy "Club members can read collections"
on public.collections for select
using (public.can_view_collection(id));

drop policy if exists "Club members can read shelves" on public.shelves;
create policy "Club members can read shelves"
on public.shelves for select
using (
  public.can_view_collection(collection_id)
  and (deleted_at is null or public.can_manage_collection(collection_id))
);

drop policy if exists "Club members can read media" on public.media_items;
create policy "Club members can read media"
on public.media_items for select
using (
  public.can_view_collection(collection_id)
  and (deleted_at is null or public.can_manage_collection(collection_id))
);

notify pgrst, 'reload schema';
