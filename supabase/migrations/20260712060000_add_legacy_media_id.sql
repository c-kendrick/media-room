-- Adds an idempotent link to the current static Media Room export.
-- Apply this after 20260712050000_media_room_foundation.sql.

alter table public.media_items
  add column legacy_id text;

alter table public.media_items
  add constraint media_items_collection_legacy_id_key
  unique (collection_id, legacy_id);
