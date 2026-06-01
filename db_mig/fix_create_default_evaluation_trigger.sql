BEGIN;

-- create_default_evaluation 트리거 개선:
--   1) active 평가기간이 없으면 자동 evaluation 을 만들지 않는다.
--      (이전: period_id 가 NULL 인 채로 current year evaluation 을 생성할 수 있었음)
--   2) 같은 evaluatee + 같은 평가기간에 이미 active evaluation 이 있으면 중복 생성하지 않는다.
--      (이전: 직원 재등록/신규 INSERT 마다 빈 draft evaluation 이 중복 생성되던 문제)
CREATE OR REPLACE FUNCTION public.create_default_evaluation()
RETURNS trigger AS $$
DECLARE
  active_period_id uuid;
  active_period_year integer;
BEGIN
  IF NOT (
    NEW.available_roles @> ARRAY['evaluatee']::text[]
    AND NEW.evaluator_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  SELECT id, evaluation_year
    INTO active_period_id, active_period_year
  FROM public.evaluation_periods
  WHERE status = 'active'
  ORDER BY is_default DESC, starts_on DESC NULLS LAST, created_at DESC
  LIMIT 1;

  -- 활성 평가기간이 없으면 자동 생성하지 않는다.
  IF active_period_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 같은 evaluatee + 평가기간에 이미 active evaluation 이 있으면 중복 생성하지 않는다.
  IF EXISTS (
    SELECT 1
    FROM public.evaluations
    WHERE evaluatee_id = NEW.employee_id
      AND evaluation_period_id = active_period_id
      AND COALESCE(record_status, 'active') = 'active'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.evaluations (
    evaluatee_id,
    evaluatee_name,
    evaluatee_position,
    evaluatee_department,
    growth_level,
    evaluation_status,
    evaluation_year,
    evaluation_period_id,
    created_at,
    updated_at
  ) VALUES (
    NEW.employee_id,
    NEW.name,
    NEW.position,
    NEW.department,
    COALESCE(NEW.growth_level, 0),
    'draft',
    COALESCE(active_period_year, EXTRACT(YEAR FROM CURRENT_DATE)),
    active_period_id,
    now(),
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
