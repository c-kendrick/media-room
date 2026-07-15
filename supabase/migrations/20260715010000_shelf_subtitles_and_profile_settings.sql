-- Optional shelf subtitles plus a narrow, self-service display-name update.

alter table public.shelves
  add column if not exists subtitle text;

alter table public.shelves
  drop constraint if exists shelves_subtitle_length;

alter table public.shelves
  add constraint shelves_subtitle_length check (
    subtitle is null or char_length(trim(subtitle)) <= 180
  );

create or replace function public.update_own_display_name(new_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_name text := trim(coalesce(new_display_name, ''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(cleaned_name) < 2 or char_length(cleaned_name) > 80 then
    raise exception 'Display name must be between 2 and 80 characters';
  end if;

  update public.profiles
  set display_name = cleaned_name
  where id = auth.uid();

  if not found then raise exception 'Profile not found'; end if;
end;
$$;

revoke all on function public.update_own_display_name(text) from public;
grant execute on function public.update_own_display_name(text) to authenticated;

notify pgrst, 'reload schema';
