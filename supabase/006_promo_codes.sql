-- テスター用の招待コード:お金なしで、決まった期間だけ有料プランを使えるようにする
create table if not exists public.promo_codes (
  code text primary key,
  plan text not null default 'team' check (plan in ('team','org')),
  months int not null default 3 check (months between 1 and 24),
  max_uses int not null default 1 check (max_uses >= 1),
  used int not null default 0,
  note text default '',
  created_at timestamptz not null default now()
);
create table if not exists public.promo_redemptions (
  id bigint generated always as identity primary key,
  code text not null references public.promo_codes(code),
  team_id uuid references public.teams(id) on delete set null,
  user_id uuid,
  created_at timestamptz not null default now()
);
alter table public.promo_codes enable row level security;        -- サーバー(service role)からだけ読み書き
alter table public.promo_redemptions enable row level security;
alter table public.teams add column if not exists comp_until timestamptz;  -- この日時まで無料で有料プラン(テスター特典)
