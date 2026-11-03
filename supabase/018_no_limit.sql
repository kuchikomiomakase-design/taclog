-- 運営用:上限なしのチーム(no_limit = true)。1日のマップ数・質問数の上限を数えない。
alter table public.teams add column if not exists no_limit boolean not null default false;

create or replace function public.add_maps(t uuid, n int) returns int
language plpgsql security definer set search_path = public as $$
declare p text; nl boolean; lim int; cur int;
begin
  select plan, no_limit into p, nl from teams where id = t;
  lim := case when nl then null else daily_map_limit(p) end;
  select coalesce((select maps from usage_daily where team_id = t and day = jst_today()), 0) into cur;
  if lim is not null and cur + n > lim then raise exception 'daily map limit'; end if;
  insert into usage_daily(team_id, day, maps) values (t, jst_today(), n)
    on conflict (team_id, day) do update set maps = usage_daily.maps + n;
  return cur + n;
end $$;
revoke all on function public.add_maps(uuid, int) from public, authenticated;

create or replace function public.maps_today(t uuid) returns table(used int, lim int)
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(t) then raise exception 'not a member'; end if;
  return query select coalesce((select maps from usage_daily where team_id = t and day = jst_today()), 0),
                      (select case when no_limit then null else daily_map_limit(plan) end from teams where id = t);
end $$;
grant execute on function public.maps_today(uuid) to authenticated;
