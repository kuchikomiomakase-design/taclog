-- TacLog database schema
-- Supabase の SQL Editor に、このファイルの中身をまるごと貼り付けて「Run」してください。

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  plan text not null default 'free' check (plan in ('free','team','org')),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  display_name text not null default '' check (char_length(display_name) <= 30),
  can_stream boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.invites (
  token text primary key default encode(gen_random_bytes(12),'hex'),
  team_id uuid not null references public.teams(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  game text not null default 'valorant',
  date date,
  opp text default '' check (char_length(opp) <= 40),
  map text default '',
  start_side text default 'attack',
  yt text default '',
  file text default '',
  part int default 1,
  comps jsonb default '{}'::jsonb,
  rounds jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists matches_team_idx on public.matches(team_id, date desc);

create table if not exists public.notification_prefs (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  arrived boolean not null default true,
  missing boolean not null default true,
  report boolean not null default true,
  primary key (team_id, user_id)
);

create table if not exists public.usage (
  team_id uuid not null references public.teams(id) on delete cascade,
  month text not null,
  analyses int not null default 0,
  questions int not null default 0,
  primary key (team_id, month)
);

-- ---------- helpers ----------
create or replace function public.is_member(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from team_members where team_id = t and user_id = auth.uid());
$$;

create or replace function public.is_admin(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from team_members where team_id = t and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.plan_limits(p text)
returns table(analyses int, questions int, members int, days int)
language sql immutable as $$
  select case p when 'free' then 2 else 100000 end,
         case p when 'free' then 20 when 'team' then 300 else 100000 end,
         case p when 'free' then 3 else 1000 end,
         case p when 'free' then 14 else 36500 end;
$$;

-- ---------- RPC ----------
create or replace function public.create_team(team_name text, my_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into teams(name, created_by) values (trim(team_name), auth.uid()) returning id into tid;
  insert into team_members(team_id, user_id, role, display_name, can_stream) values (tid, auth.uid(), 'admin', left(trim(my_name),30), true);
  insert into notification_prefs(team_id, user_id) values (tid, auth.uid());
  return tid;
end $$;

create or replace function public.create_invite(t uuid) returns text
language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  if not is_admin(t) then raise exception 'admin only'; end if;
  insert into invites(team_id, created_by) values (t, auth.uid()) returning token into tok;
  return tok;
end $$;

create or replace function public.invite_info(tok text) returns table(team_name text, valid boolean)
language sql stable security definer set search_path = public as $$
  select t.name, (i.expires_at > now()) from invites i join teams t on t.id = i.team_id where i.token = tok;
$$;

create or replace function public.accept_invite(tok text, my_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; p text; cnt int; lim int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select i.team_id into tid from invites i where i.token = tok and i.expires_at > now();
  if tid is null then raise exception 'invalid invite'; end if;
  if exists(select 1 from team_members where team_id = tid and user_id = auth.uid()) then return tid; end if;
  select plan into p from teams where id = tid;
  select count(*) into cnt from team_members where team_id = tid;
  select members into lim from plan_limits(p);
  if cnt >= lim then raise exception 'member limit'; end if;
  insert into team_members(team_id, user_id, role, display_name) values (tid, auth.uid(), 'member', left(trim(my_name),30));
  insert into notification_prefs(team_id, user_id) values (tid, auth.uid()) on conflict do nothing;
  return tid;
end $$;

create or replace function public.save_match(t uuid, m jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare mid uuid; p text; lim int; used int; mon text := to_char(now(),'YYYY-MM');
begin
  if not is_member(t) then raise exception 'not a member'; end if;
  select plan into p from teams where id = t;
  select analyses into lim from plan_limits(p);
  select coalesce((select analyses from usage where team_id = t and month = mon),0) into used;
  if coalesce((m->>'part')::int,1) = 1 and used >= lim then raise exception 'analysis limit'; end if;
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

-- ---------- row level security ----------
alter table teams enable row level security;
alter table team_members enable row level security;
alter table invites enable row level security;
alter table matches enable row level security;
alter table notification_prefs enable row level security;
alter table usage enable row level security;

drop policy if exists teams_read on teams;
create policy teams_read on teams for select using (is_member(id));
drop policy if exists teams_update on teams;
create policy teams_update on teams for update using (is_admin(id)) with check (is_admin(id));

drop policy if exists members_read on team_members;
create policy members_read on team_members for select using (is_member(team_id));
drop policy if exists members_update_self on team_members;
create policy members_update_self on team_members for update using (user_id = auth.uid() or is_admin(team_id));
drop policy if exists members_delete on team_members;
create policy members_delete on team_members for delete using (is_admin(team_id) or user_id = auth.uid());

drop policy if exists invites_read on invites;
create policy invites_read on invites for select using (is_admin(team_id));
drop policy if exists invites_delete on invites;
create policy invites_delete on invites for delete using (is_admin(team_id));

drop policy if exists matches_read on matches;
create policy matches_read on matches for select using (is_member(team_id));
drop policy if exists matches_update on matches;
create policy matches_update on matches for update using (is_member(team_id));
drop policy if exists matches_delete on matches;
create policy matches_delete on matches for delete using (created_by = auth.uid() or is_admin(team_id));

drop policy if exists prefs_rw on notification_prefs;
create policy prefs_rw on notification_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists usage_read on usage;
create policy usage_read on usage for select using (is_member(team_id));

-- 書き換えてよい列だけを許可します(プランや役割は、利用者からは変えられないようにする)。
-- プラン(plan / stripe_*)の変更は、サーバー(service role)からだけ行います。
revoke update on teams from authenticated, anon;
grant update (name) on teams to authenticated;
revoke update on team_members from authenticated, anon;
grant update (display_name, can_stream) on team_members to authenticated;
revoke update on matches from authenticated, anon;
grant update (map, opp, yt, date) on matches to authenticated;
revoke insert on teams, team_members, invites, matches, usage from authenticated, anon;
