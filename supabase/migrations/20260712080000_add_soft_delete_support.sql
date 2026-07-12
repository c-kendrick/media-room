alter table public.media_items add column if not exists deleted_at timestamptz;
alter table public.shelves add column if not exists deleted_at timestamptz;
create index if not exists media_items_collection_deleted_idx on public.media_items(collection_id, deleted_at);
create index if not exists shelves_collection_deleted_idx on public.shelves(collection_id, deleted_at);