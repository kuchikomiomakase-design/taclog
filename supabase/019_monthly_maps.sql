-- 分析の上限を「1日」から「1か月」に変える(日本時間の月で数える)。
--   チーム 月40マップ / 組織 各チーム月40マップ / 個人 月20マップ
-- 上限を超えた分は「追加マップ」(10マップ 500円・買った分は月をまたいで残る)から使う。
-- AIへの質問の月の上限:チーム150 / 組織300(全チームで共有) / 個人50 / 無料20
alter table public.teams add column if not exists extra_maps int not null default 0;

create or replace function public.monthly_map_limit(p text) returns int language sql immutable as $$
  select case p when 'team' then 40 when 'org' then 40 when 'solo' then 20 else null end;
$$;
create or replace function public.jst_month_start() returns date language sql stable as $$
  select date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date
$$;
create or replace function public.maps_this_month(t uuid) returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(maps),0)::int from usage_daily where team_id = t and day >= jst_month_start();
$$;
revoke all on function public.maps_this_month(uuid) from public, authenticated;

create or replace function public.plan_limits(p text)
returns table(analyses int, questions int, members int, days int)
language sql immutable as $$
  select case p when 'free' then 2 else 100000 end,
         case p when 'free' then 20 when 'team' then 150 when 'org' then 300 when 'solo' then 50 else 100000 end,
         case p when 'free' then 3 when 'solo' then 1 else 1000 end,
         case p when 'free' then 14 else 36500 end;
$$;

-- counts n maps; past the monthly limit they come out of the bought extra maps
create or replace function public.add_maps(t uuid, n int) returns int
language plpgsql security definer set search_path = public as $$
declare p text; nl boolean; extra int; lim int; cur int; over int;
begin
  select plan, no_limit, extra_maps into p, nl, extra from teams where id = t for update;
  lim := case when nl then null else monthly_map_limit(p) end;
  cur := maps_this_month(t);
  if lim is not null and cur + n > lim then
    over := least(n, cur + n - lim);
    if coalesce(extra,0) < over then raise exception 'monthly map limit'; end if;
    update teams set extra_maps = extra_maps - over where id = t;
  end if;
  insert into usage_daily(team_id, day, maps) values (t, jst_today(), n)
    on conflict (team_id, day) do update set maps = usage_daily.maps + n;
  return cur + n;
end $$;
revoke all on function public.add_maps(uuid, int) from public, authenticated;

-- what the app shows: used this month, the monthly limit (null = none), extra maps left
create or replace function public.maps_month(t uuid) returns table(used int, lim int, extra int)
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(t) then raise exception 'not a member'; end if;
  return query select maps_this_month(t),
                      (select case when no_limit then null else monthly_map_limit(plan) end from teams where id = t),
                      (select extra_maps from teams where id = t);
end $$;
grant execute on function public.maps_month(uuid) to authenticated;

-- older app versions still call maps_today: answer with the month figures (limit includes the extra maps)
create or replace function public.maps_today(t uuid) returns table(used int, lim int)
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(t) then raise exception 'not a member'; end if;
  return query select m.used, case when m.lim is null then null else m.lim + coalesce(m.extra,0) end from maps_month(t) m;
end $$;
grant execute on function public.maps_today(uuid) to authenticated;

-- extra maps bought through Stripe: each payment is granted once, even if Stripe sends the event again
create table if not exists public.map_grants (
  ref text primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  maps int not null,
  created_at timestamptz not null default now()
);
alter table public.map_grants enable row level security;
create or replace function public.grant_maps(t uuid, n int, r text) returns int
language plpgsql security definer set search_path = public as $$
declare got int;
begin
  insert into map_grants(ref, team_id, maps) values (r, t, n) on conflict (ref) do nothing;
  get diagnostics got = row_count;
  if got = 0 then return (select extra_maps from teams where id = t); end if;
  update teams set extra_maps = extra_maps + n where id = t;
  return (select extra_maps from teams where id = t);
end $$;
revoke all on function public.grant_maps(uuid, int, text) from public, authenticated;
