-- チームプランは、録画の分析を1日6マップ分まで(日本時間で日付が変わるとリセット)。
-- 1マップ × 1人の録画 = 1。3マップ入りの動画なら3、同じ試合を2人が録画したら2。
create table if not exists public.usage_daily (
  team_id uuid not null references public.teams(id) on delete cascade,
  day date not null,
  maps int not null default 0,
  primary key (team_id, day)
);
alter table public.usage_daily enable row level security;
drop policy if exists usage_daily_read on public.usage_daily;
create policy usage_daily_read on public.usage_daily for select using (is_member(team_id));
grant select on public.usage_daily to authenticated;

create or replace function public.daily_map_limit(p text) returns int language sql immutable as $$
  select case p when 'team' then 6 else null end;
$$;
create or replace function public.jst_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Tokyo')::date $$;

create or replace function public.add_maps(t uuid, n int) returns int
language plpgsql security definer set search_path = public as $$
declare p text; lim int; cur int;
begin
  select plan into p from teams where id = t;
  lim := daily_map_limit(p);
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
                      daily_map_limit((select plan from teams where id = t));
end $$;
grant execute on function public.maps_today(uuid) to authenticated;

-- every saved map counts 1
create or replace function public.save_match(t uuid, m jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid; p text; lim int; used int; mon text := to_char(now(),'YYYY-MM');
begin
  if not is_member(t) then raise exception 'not a member'; end if;
  select plan into p from teams where id = t;
  select analyses into lim from plan_limits(p);
  select coalesce((select analyses from usage where team_id = t and month = mon),0) into used;
  if coalesce((m->>'part')::int,1) = 1 and used >= lim then raise exception 'analysis limit'; end if;
  perform add_maps(t, 1);
  insert into matches(team_id, date, opp, map, start_side, yt, file, part, comps, rounds, created_by)
  values (t, nullif(m->>'date','')::date, coalesce(m->>'opp',''), coalesce(m->>'map',''), coalesce(m->>'start_side','attack'),
          coalesce(m->>'yt',''), coalesce(m->>'file',''), coalesce((m->>'part')::int,1), coalesce(m->'comps','{}'::jsonb),
          coalesce(m->'rounds','[]'::jsonb), auth.uid())
  returning id into mid;
  if coalesce((m->>'part')::int,1) = 1 then
    insert into usage(team_id, month, analyses) values (t, mon, 1)
    on conflict (team_id, month) do update set analyses = usage.analyses + 1;
  end if;
  return mid;
end $$;

-- another player's recording of a match that is already saved also counts 1 (the first recording was counted by save_match)
create or replace function public.count_pov() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.file,'') <> coalesce((select file from matches where id = new.match_id),'') then perform add_maps(new.team_id, 1); end if;
  return new;
end $$;
drop trigger if exists count_pov on public.match_povs;
create trigger count_pov before insert on public.match_povs for each row execute function public.count_pov();
