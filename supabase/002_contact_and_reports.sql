-- TacLog 追加分:お問い合わせ と 月末の成果報告 用のテーブル
-- Supabase の SQL Editor に、このファイルの中身をまるごと貼り付けて「Run」してください(1回だけでOK)。

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  email text default '',
  subject text not null check (char_length(subject) between 1 and 80),
  status text not null default 'open' check (status in ('open','closed')),
  discord_thread_id text,
  last_synced_id text,
  last_staff_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists inquiries_user_idx on public.inquiries(user_id, created_at desc);

create table if not exists public.inquiry_messages (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  author text not null check (author in ('user','staff')),
  body text not null check (char_length(body) between 1 and 4000),
  discord_message_id text unique,
  created_at timestamptz not null default now()
);
create index if not exists inquiry_messages_idx on public.inquiry_messages(inquiry_id, created_at);

-- AIの利用量(出費の集計に使います)
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  team_id uuid references public.teams(id) on delete set null,
  kind text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_created_idx on public.ai_usage(created_at);

-- 書き込みはサーバー(service role)からだけ。利用者は自分の問い合わせを読むだけ。
alter table inquiries enable row level security;
alter table inquiry_messages enable row level security;
alter table ai_usage enable row level security;

drop policy if exists inquiries_read_own on inquiries;
create policy inquiries_read_own on inquiries for select using (user_id = auth.uid());
drop policy if exists inquiry_messages_read_own on inquiry_messages;
create policy inquiry_messages_read_own on inquiry_messages for select using (exists (select 1 from inquiries i where i.id = inquiry_id and i.user_id = auth.uid()));

revoke insert, update, delete on inquiries, inquiry_messages, ai_usage from authenticated, anon;
revoke select on ai_usage from authenticated, anon;
