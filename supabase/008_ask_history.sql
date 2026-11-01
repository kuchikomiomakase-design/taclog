-- AIへの質問の履歴(会話ごと)。本人だけが見られる。
create table if not exists public.ask_threads (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ask_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.ask_threads(id) on delete cascade,
  question text not null,
  answer jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ask_threads_user_idx on public.ask_threads(user_id, team_id, updated_at desc);
create index if not exists ask_messages_thread_idx on public.ask_messages(thread_id, id);
alter table public.ask_threads enable row level security;
alter table public.ask_messages enable row level security;
drop policy if exists ask_threads_own on public.ask_threads;
drop policy if exists ask_messages_own on public.ask_messages;
create policy ask_threads_own on public.ask_threads for all
  using (user_id = auth.uid() and is_member(team_id)) with check (user_id = auth.uid() and is_member(team_id));
create policy ask_messages_own on public.ask_messages for all
  using (exists (select 1 from public.ask_threads t where t.id = thread_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.ask_threads t where t.id = thread_id and t.user_id = auth.uid()));
grant select, insert, update, delete on public.ask_threads to authenticated;
grant select, insert, delete on public.ask_messages to authenticated;
