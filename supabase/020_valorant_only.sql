-- いったん VALORANT だけにする(Overwatch 2 は外す。作ったら戻す)
create or replace function public.valid_games() returns text[]
language sql immutable as $$ select array['valorant']; $$;
update public.teams set games = coalesce(nullif(array(select g from unnest(games) g where g = 'valorant'), '{}'), array['valorant']);
