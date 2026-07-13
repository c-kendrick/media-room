-- Backup restore needs the provider metadata column on installations that
-- skipped the earlier complete-workflow migration.
alter table public.media_items
  add column if not exists external_ids jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
