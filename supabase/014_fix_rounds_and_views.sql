-- 1) ラウンドの手直し:メンバーなら、読み取れなかった・間違えたラウンドを手で直せる(勝敗・攻守・設置・ファーストキルなど)
create or replace function public.update_rounds(m uuid, rs jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select team_id into t from matches where id = m;
  if t is null or not is_member(t) then raise exception 'not a member'; end if;
  if jsonb_typeof(rs) <> 'array' or jsonb_array_length(rs) > 60 then raise exception 'bad rounds'; end if;
  update matches set rounds = rs where id = m;
end $$;
grant execute on function public.update_rounds(uuid, jsonb) to authenticated;

-- 2) 全員視点(組織プラン・オプション):2人目以降の視点は1チーム1日24本まで
alter table public.usage_daily add column if not exists views int not null default 0;
create or replace function public.count_pov() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; free_views boolean; cur int;
begin
  select count(*) into n from match_povs where match_id = new.match_id;
  if n >= 5 then raise exception 'view limit'; end if;
  if coalesce(new.file,'') = coalesce((select file from matches where id = new.match_id),'') then return new; end if;   -- the first recording (counted by save_match)
  select (plan = 'org' or pov_option) into free_views from teams where id = new.team_id;
  if coalesce(free_views,false) then
    select coalesce((select views from usage_daily where team_id = new.team_id and day = jst_today()),0) into cur;
    if cur >= 24 then raise exception 'daily view limit'; end if;
    insert into usage_daily(team_id, day, views) values (new.team_id, jst_today(), 1)
      on conflict (team_id, day) do update set views = usage_daily.views + 1;
  else
    perform add_maps(new.team_id, 1);
  end if;
  return new;
end $$;
