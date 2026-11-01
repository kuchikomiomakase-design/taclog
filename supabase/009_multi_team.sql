-- 2つ目以降のチームを作れるのは、コーチ・組織プランのチームを管理している人だけ。
-- 新しいチームも組織プランになる(元のチームの無料期間 comp_until も引き継ぐ)。1人10チームまで。
create or replace function public.create_team(team_name text, my_name text, game text) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; owned int; org record;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not (game = any(valid_games())) then raise exception 'invalid game'; end if;
  select count(*) into owned from teams where created_by = auth.uid();
  select t.plan, t.comp_until into org from teams t join team_members m on m.team_id = t.id
    where m.user_id = auth.uid() and m.role = 'admin' and t.plan = 'org' order by t.created_at limit 1;
  if owned >= 1 and org is null then raise exception 'org plan required'; end if;
  if owned >= 10 then raise exception 'team limit'; end if;
  insert into teams(name, created_by, games, plan, comp_until)
    values (trim(team_name), auth.uid(), array[game], case when org is null then 'free' else 'org' end, case when org is null then null else org.comp_until end)
    returning id into tid;
  insert into team_members(team_id, user_id, role, display_name, can_stream) values (tid, auth.uid(), 'admin', left(trim(my_name),30), true);
  insert into notification_prefs(team_id, user_id) values (tid, auth.uid());
  return tid;
end $$;
