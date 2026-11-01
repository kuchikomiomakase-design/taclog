-- 試作期間の終わり(Riotに申請するとき):プランごとの制限に戻す
create or replace function public.plan_limits(p text)
returns table(analyses int, questions int, members int, days int)
language sql immutable as $$
  select case p when 'free' then 2 else 100000 end,
         case p when 'free' then 20 when 'team' then 150 else 100000 end,
         case p when 'free' then 3 else 1000 end,
         case p when 'free' then 14 else 36500 end;
$$;
