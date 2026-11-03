-- 手直し画面で、エージェント構成(自チーム5人・相手5人)も直せるようにする
create or replace function public.update_comps(m uuid, c jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select team_id into t from matches where id = m;
  if t is null or not is_member(t) then raise exception 'not a member'; end if;
  if jsonb_typeof(c) <> 'object' then raise exception 'bad comps'; end if;
  update matches set comps = coalesce(comps,'{}'::jsonb) || jsonb_build_object('left', coalesce(c->'left','[]'::jsonb), 'right', coalesce(c->'right','[]'::jsonb)) where id = m;
end $$;
grant execute on function public.update_comps(uuid, jsonb) to authenticated;
