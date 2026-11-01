-- 個人プラン(solo)と、全員視点オプション(pov_option)。
-- 個人:1人用。分析は1日2マップ分、質問は月100回(サーバー側)。チームを持っている人も、個人用を1つだけ作れる。
-- 全員視点オプション(チームプラン+980円、組織プランは込み):同じ試合の2人目以降の録画は1日の上限に数えない。1試合5人分まで。
alter table public.teams add column if not exists kind text not null default 'team';
alter table public.teams add column if not exists pov_option boolean not null default false;
alter table public.teams drop constraint if exists teams_plan_check;
alter table public.teams add constraint teams_plan_check check (plan in ('free','team','org','solo'));
alter table public.teams drop constraint if exists teams_kind_check;
alter table public.teams add constraint teams_kind_check check (kind in ('team','solo'));

create or replace function public.daily_map_limit(p text) returns int language sql immutable as $$
  select case p when 'team' then 6 when 'org' then 6 when 'solo' then 2 else null end;
$$;
create or replace function public.plan_limits(p text)
returns table(analyses int, questions int, members int, days int)
language sql immutable as $$
  select case p when 'free' then 2 else 100000 end,
         case p when 'free' then 20 when 'team' then 300 when 'org' then 600 when 'solo' then 100 else 100000 end,
         case p when 'free' then 3 when 'solo' then 1 else 1000 end,
         case p when 'free' then 14 else 36500 end;
$$;

drop function if exists public.create_team(text, text, text);
create or replace function public.create_team(team_name text, my_name text, game text, team_kind text default 'team') returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; owned int; solos int; org record; k text := case when team_kind = 'solo' then 'solo' else 'team' end;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not (game = any(valid_games())) then raise exception 'invalid game'; end if;
  select count(*) filter (where kind = 'team'), count(*) filter (where kind = 'solo') into owned, solos from teams where created_by = auth.uid();
  select t.plan, t.comp_until into org from teams t join team_members m on m.team_id = t.id
    where m.user_id = auth.uid() and m.role = 'admin' and t.plan = 'org' order by t.created_at limit 1;
  if k = 'solo' then
    if solos >= 1 then raise exception 'solo exists'; end if;
  else
    if owned >= 1 and org.plan is null then raise exception 'org plan required'; end if;
    if owned >= 10 then raise exception 'team limit'; end if;
  end if;
  insert into teams(name, created_by, games, kind, plan, comp_until)
    values (trim(team_name), auth.uid(), array[game], k,
            case when k = 'team' and org.plan is not null then 'org' else 'free' end,
            case when k = 'team' and org.plan is not null then org.comp_until else null end)
    returning id into tid;
  insert into team_members(team_id, user_id, role, display_name, can_stream) values (tid, auth.uid(), 'admin', left(trim(my_name),30), true);
  insert into notification_prefs(team_id, user_id) values (tid, auth.uid());
  return tid;
end $$;
grant execute on function public.create_team(text, text, text, text) to authenticated;

-- another player's recording of a saved match: 5 views per match at most; it counts toward the daily limit unless the team has the all-views option (org: included)
create or replace function public.count_pov() returns trigger
language plpgsql security definer set search_path = public as $$
declare views int; free_views boolean;
begin
  select count(*) into views from match_povs where match_id = new.match_id;
  if views >= 5 then raise exception 'view limit'; end if;
  select (plan = 'org' or pov_option) into free_views from teams where id = new.team_id;
  if coalesce(new.file,'') <> coalesce((select file from matches where id = new.match_id),'') and not coalesce(free_views,false) then
    perform add_maps(new.team_id, 1);
  end if;
  return new;
end $$;
