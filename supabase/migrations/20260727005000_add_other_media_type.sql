-- Kept in a separate migration because PostgreSQL enum values added inside a
-- transaction cannot be used until that transaction commits.
alter type public.media_type add value if not exists 'other';
