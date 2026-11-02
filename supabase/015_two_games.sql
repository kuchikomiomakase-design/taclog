-- いったん VALORANT と Overwatch 2 だけにする(CS2・Apex・Fortnite は外す。サンプル録画がそろったら戻す)
create or replace function public.valid_games() returns text[]
language sql immutable as $$ select array['valorant','ow2']; $$;
update public.teams set games = coalesce(nullif(array(select g from unnest(games) g where g in ('valorant','ow2')), '{}'), array['valorant']);
