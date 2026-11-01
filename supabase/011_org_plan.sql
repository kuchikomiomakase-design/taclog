-- コーチ・組織プラン:各チーム1日6マップ分まで(チームプランと同じ)。質問は組織の全チームで月600回(サーバー側で数えます)。
create or replace function public.daily_map_limit(p text) returns int language sql immutable as $$
  select case p when 'team' then 6 when 'org' then 6 else null end;
$$;
