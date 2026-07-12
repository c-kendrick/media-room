create or replace function public.move_shelf_item(target_shelf_id uuid, target_media_item_id uuid, target_index integer)
returns void language plpgsql security definer set search_path=public as $$
declare cid uuid; begin
select collection_id into cid from public.shelves where id=target_shelf_id;
if not public.can_manage_collection(cid) then raise exception 'Not allowed'; end if;
with ranked as (select media_item_id,row_number() over(order by position, media_item_id)-1 as idx from public.shelf_media_items where shelf_id=target_shelf_id),
ordered as (select media_item_id,case when media_item_id=target_media_item_id then target_index when idx>=target_index and idx<(select idx from ranked where media_item_id=target_media_item_id) then idx+1 when idx<=target_index and idx>(select idx from ranked where media_item_id=target_media_item_id) then idx-1 else idx end as next_idx from ranked)
update public.shelf_media_items s set position=o.next_idx*1000 from ordered o where s.shelf_id=target_shelf_id and s.media_item_id=o.media_item_id;
end $$;
grant execute on function public.move_shelf_item(uuid,uuid,integer) to authenticated;