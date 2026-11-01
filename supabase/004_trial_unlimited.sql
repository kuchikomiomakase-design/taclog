-- 試作期間中:すべてのプランで分析・質問・メンバー・見られる期間を無制限にする
create or replace function public.plan_limits(p text)
returns table(analyses int, questions int, members int, days int)
language sql immutable as $$
  select 100000, 100000, 1000, 36500;
$$;
