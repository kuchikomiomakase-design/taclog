-- 組織プランで追加したチームは、元のチーム(parent_team)のプランに従う。元のチームが解約されると一緒に無料に戻る。
alter table public.teams add column if not exists parent_team uuid references public.teams(id) on delete set null;
create index if not exists teams_parent_idx on public.teams(parent_team);
