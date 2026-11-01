-- TacLog 追加分:ゲームタイトル(1つ目は無料、2つ目から追加料金)
-- Supabase の SQL Editor に、このファイルの中身をまるごと貼り付けて「Run」してください(1回だけでOK)。

alter table public.teams add column if not exists games text[] not null default '{valorant}';
alter table public.teams add column if not exists extra_games int not null default 0;

-- 使えるタイトルの数:コーチ・組織プランは全部、それ以外は 1 + 追加購入した数
create or replace function public.allowed_games(t uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when plan = 'org' then 99 else 1 + extra_games end from teams where id = t;
$$;

create or replace function public.valid_games() returns text[]
language sql immutable as $$ select array['valorant','cs2','ow2','apex','fortnite']; $$;

-- チーム作成(最初に選んだタイトル1つで作る)
create or replace function public.create_team(team_name text, my_name text, game text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not (game = any(valid_games())) then raise exception 'invalid game'; end if;
  insert into teams(name, created_by, games) values (trim(team_name), auth.uid(), array[game]) returning id into tid;
  insert into team_members(team_id, user_id, role, display_name, can_stream) values (tid, auth.uid(), 'admin', left(trim(my_name),30), true);
  insert into notification_prefs(team_id, user_id) values (tid, auth.uid());
  return tid;
end $$;

-- タイトルの入れ替え・削除(使える数の範囲内だけ。増やすときは /api/games で支払い)
create or replace function public.set_games(t uuid, g text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(t) then raise exception 'admin only'; end if;
  if g is null or cardinality(g) < 1 then raise exception 'at least one game'; end if;
  if not (g <@ valid_games()) then raise exception 'invalid game'; end if;
  if cardinality(g) > allowed_games(t) then raise exception 'game limit'; end if;
  update teams set games = (select array_agg(distinct x) from unnest(g) x) where id = t;
end $$;
