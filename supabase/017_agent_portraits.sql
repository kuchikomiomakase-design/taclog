-- エージェントの顔の見本。分析後の「エージェント構成」で人が確認した顔(小さな24x24の画像)をためて、次の分析から見比べて判定する。
-- 試合や選手の情報は入らない(ゲームのエージェント画像だけ)。
create table if not exists public.agent_portraits (
  id bigint generated always as identity primary key,
  agent text not null,
  side text not null check (side in ('left','right')),
  px text not null check (length(px) < 4000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists agent_portraits_agent_idx on public.agent_portraits(agent, side);
alter table public.agent_portraits enable row level security;
drop policy if exists ap_read on public.agent_portraits;
drop policy if exists ap_add on public.agent_portraits;
create policy ap_read on public.agent_portraits for select to authenticated using (true);
create policy ap_add on public.agent_portraits for insert to authenticated with check (created_by = auth.uid());
grant select, insert on public.agent_portraits to authenticated;
