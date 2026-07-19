-- Canonical likes and Priority Stamps shared across matching collection copies.

create or replace function public.media_reaction_work_key(media_type text, media_title text, media_year integer)
returns text language sql immutable set search_path=public as $$
  select concat(
    case lower(trim(coalesce(media_type, '')))
      when 'movie' then 'film' when 'movies' then 'film' when 'films' then 'film'
      when 'tv' then 'television' when 'series' then 'television' when 'show' then 'television'
      else lower(trim(coalesce(media_type, '')))
    end,
    '|',
    regexp_replace(
      trim(regexp_replace(lower(replace(trim(coalesce(media_title, '')), '&', ' and ')), '[^[:alnum:]]+', ' ', 'g')),
      '^(the|a|an) ', ''
    ),
    '|', coalesce(media_year::text, '')
  );
$$;

create table if not exists public.media_reactions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('like', 'priority')),
  work_key text not null,
  media_type text not null,
  media_title text not null,
  media_year integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, work_key)
);
create index if not exists media_reactions_work_key_idx on public.media_reactions(work_key, kind);
drop trigger if exists media_reactions_set_updated_at on public.media_reactions;
create trigger media_reactions_set_updated_at before update on public.media_reactions
for each row execute function public.set_updated_at();

alter table public.media_reactions enable row level security;
revoke all on public.media_reactions from public, anon, authenticated;

create or replace function public.can_view_media_reaction(target_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.profile_is_active(auth.uid())
    and public.profile_is_active(target_user_id)
    and (
      target_user_id = auth.uid()
      or exists (
        select 1 from public.collections c
        where c.owner_id = target_user_id and public.can_view_collection(c.id)
      )
    );
$$;

drop policy if exists "Signed-in viewers can read visible media reactions" on public.media_reactions;
create policy "Signed-in viewers can read visible media reactions"
on public.media_reactions for select to authenticated
using (public.can_view_media_reaction(user_id));

-- Preserve every existing Priority Watch stamp as a canonical reaction.
insert into public.media_reactions(user_id, kind, work_key, media_type, media_title, media_year, created_at, updated_at)
select i.user_id, 'priority', public.media_reaction_work_key(m.type::text, m.title, m.year::integer), m.type::text, m.title, m.year, i.created_at, i.created_at
from public.media_interest i
join public.media_items m on m.id = i.media_item_id
on conflict (user_id, kind, work_key) do nothing;

create or replace function public.set_media_reaction(target_media_item_id uuid, reaction_kind text, reaction_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
declare
  target public.media_items;
  target_key text;
begin
  if not public.profile_is_active(auth.uid()) then
    raise exception 'Approved active account required';
  end if;
  if reaction_kind not in ('like', 'priority') then
    raise exception 'Unsupported reaction';
  end if;

  select * into target from public.media_items
  where id = target_media_item_id and deleted_at is null;
  if not found or not public.can_view_media_item(target_media_item_id) then
    raise exception 'Visible media item required';
  end if;
  if reaction_kind = 'priority' and target.type not in ('film', 'television') then
    raise exception 'Priority Watch is only available for films and television';
  end if;

  target_key := public.media_reaction_work_key(target.type::text, target.title, target.year::integer);
  if reaction_enabled then
    insert into public.media_reactions(user_id, kind, work_key, media_type, media_title, media_year)
    values(auth.uid(), reaction_kind, target_key, target.type::text, target.title, target.year)
    on conflict (user_id, kind, work_key) do update set
      media_type=excluded.media_type, media_title=excluded.media_title,
      media_year=excluded.media_year, updated_at=now();
  else
    delete from public.media_reactions
    where user_id=auth.uid() and kind=reaction_kind and work_key=target_key;
  end if;

  -- Keep the existing Main Watchlist calculation intact. One legacy row is
  -- enough: its identity is already deduplicated per person and work.
  if reaction_kind = 'priority' then
    delete from public.media_interest i using public.media_items m
    where i.media_item_id=m.id and i.user_id=auth.uid()
      and public.media_reaction_work_key(m.type::text, m.title, m.year::integer)=target_key;
    if reaction_enabled then
      insert into public.media_interest(media_item_id, user_id)
      values(target_media_item_id, auth.uid()) on conflict do nothing;
    end if;
  end if;
end $$;

revoke all on function public.media_reaction_work_key(text, text, integer) from public;
revoke all on function public.can_view_media_reaction(uuid) from public;
revoke all on function public.set_media_reaction(uuid, text, boolean) from public, anon;
grant select on public.media_reactions to authenticated;
grant execute on function public.can_view_media_reaction(uuid) to authenticated;
grant execute on function public.set_media_reaction(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
