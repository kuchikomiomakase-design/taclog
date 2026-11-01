-- 同じ試合を、チームの何人かがそれぞれの視点で録画して読み込んだときに、1試合にまとめるための表。
-- チームの数字(勝敗・攻守・設置など)は matches に1回だけ、選手ごとの数字(その人のファーストキル・デス、生存など)は視点ごとにここへ。
create table if not exists public.match_povs (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  agent text default '',
  file text default '',
  rounds jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists match_povs_match_idx on public.match_povs(match_id);
alter table public.match_povs enable row level security;
drop policy if exists povs_read on public.match_povs;
drop policy if exists povs_add on public.match_povs;
drop policy if exists povs_del on public.match_povs;
create policy povs_read on public.match_povs for select using (is_member(team_id));
create policy povs_add on public.match_povs for insert with check (is_member(team_id));
create policy povs_del on public.match_povs for delete using (is_member(team_id));
grant select, insert, delete on public.match_povs to authenticated;
