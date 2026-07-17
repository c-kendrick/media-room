create table if not exists public.enrichment_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  requested_at timestamptz not null default now()
);

create index if not exists enrichment_requests_user_action_time_idx
  on public.enrichment_requests (user_id, action, requested_at desc);

alter table public.enrichment_requests enable row level security;
revoke all on public.enrichment_requests from anon, authenticated;

create or replace function public.claim_enrichment_request(target_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  cooldown_seconds integer;
  hourly_limit integer;
  latest_request timestamptz;
  oldest_hour_request timestamptz;
  requests_this_hour integer;
  cooldown_remaining integer := 0;
  hourly_remaining integer := 0;
  retry_after integer := 0;
begin
  if actor is null then
    raise exception 'Sign in is required.';
  end if;

  select limits.cooldown_seconds, limits.hourly_limit
    into cooldown_seconds, hourly_limit
  from (values
    ('poster-batch', 120, 10),
    ('details-batch', 120, 10),
    ('poster-search', 6, 60),
    ('details-search', 6, 60)
  ) as limits(action, cooldown_seconds, hourly_limit)
  where limits.action = target_action;

  if cooldown_seconds is null then
    raise exception 'Unknown enrichment action.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || target_action, 0));

  delete from public.enrichment_requests
  where user_id = actor and requested_at < now() - interval '2 hours';

  select max(requested_at), count(*)::integer, min(requested_at)
    into latest_request, requests_this_hour, oldest_hour_request
  from public.enrichment_requests
  where user_id = actor
    and action = target_action
    and requested_at > now() - interval '1 hour';

  if latest_request is not null then
    cooldown_remaining := greatest(0, ceil(extract(epoch from (latest_request + make_interval(secs => cooldown_seconds) - now())))::integer);
  end if;

  if requests_this_hour >= hourly_limit and oldest_hour_request is not null then
    hourly_remaining := greatest(0, ceil(extract(epoch from (oldest_hour_request + interval '1 hour' - now())))::integer);
  end if;

  retry_after := greatest(cooldown_remaining, hourly_remaining);
  if retry_after > 0 then
    return jsonb_build_object('allowed', false, 'retry_after', retry_after, 'hourly_limit', hourly_limit);
  end if;

  insert into public.enrichment_requests (user_id, action) values (actor, target_action);
  return jsonb_build_object('allowed', true, 'retry_after', 0, 'hourly_limit', hourly_limit);
end;
$$;

revoke all on function public.claim_enrichment_request(text) from public, anon;
grant execute on function public.claim_enrichment_request(text) to authenticated;

comment on function public.claim_enrichment_request(text) is
  'Atomically enforces per-user enrichment cooldowns and rolling hourly quotas.';

notify pgrst, 'reload schema';
