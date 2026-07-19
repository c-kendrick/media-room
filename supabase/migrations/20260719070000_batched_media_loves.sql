-- Apply debounced Love changes in one authenticated, atomic transaction.

create or replace function public.set_media_love_batch(reaction_changes jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  change jsonb;
begin
  if not public.profile_is_active(auth.uid()) then
    raise exception 'Approved active account required';
  end if;
  if coalesce(jsonb_typeof(reaction_changes), 'null') <> 'array'
    or jsonb_array_length(reaction_changes) < 1
    or jsonb_array_length(reaction_changes) > 200 then
    raise exception 'Between 1 and 200 Love changes are required';
  end if;

  for change in select value from jsonb_array_elements(reaction_changes)
  loop
    if not (change ? 'media_item_id') or not (change ? 'enabled') then
      raise exception 'Each Love change requires a media item and enabled state';
    end if;
    perform public.set_media_reaction(
      (change->>'media_item_id')::uuid,
      'like',
      (change->>'enabled')::boolean
    );
  end loop;
end $$;

revoke all on function public.set_media_love_batch(jsonb) from public, anon;
grant execute on function public.set_media_love_batch(jsonb) to authenticated;

notify pgrst, 'reload schema';
