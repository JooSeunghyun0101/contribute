BEGIN;

WITH active_period AS (
  SELECT id, evaluation_year
  FROM public.evaluation_periods
  WHERE status = 'active'
  ORDER BY is_default DESC, starts_on DESC NULLS LAST, created_at DESC
  LIMIT 1
),
source_history AS (
  SELECT DISTINCT ON (h.employee_id)
    h.id AS history_id,
    e.employee_id,
    e.name,
    e.position,
    e.department,
    e.growth_level
  FROM public.evaluator_assignment_history h
  INNER JOIN public.employees e ON e.employee_id = h.employee_id
  WHERE h.status = 'applied'
    AND h.change_type = 'change'
    AND h.evaluation_id IS NULL
    AND h.new_evaluator_id IS NOT NULL
    AND e.evaluator_id IS NOT DISTINCT FROM h.new_evaluator_id
  ORDER BY h.employee_id, h.changed_at DESC, h.id DESC
),
inserted_evaluations AS (
  INSERT INTO public.evaluations (
    evaluatee_id,
    evaluatee_name,
    evaluatee_position,
    evaluatee_department,
    growth_level,
    evaluation_status,
    evaluation_year,
    evaluation_period_id,
    last_modified,
    created_at,
    updated_at
  )
  SELECT
    s.employee_id,
    s.name,
    s.position,
    s.department,
    COALESCE(s.growth_level, 0),
    'draft',
    COALESCE(p.evaluation_year, EXTRACT(YEAR FROM CURRENT_DATE)::integer),
    p.id,
    now(),
    now(),
    now()
  FROM source_history s
  CROSS JOIN active_period p
  RETURNING id, evaluatee_id, evaluation_period_id
)
UPDATE public.evaluator_assignment_history h
SET
  evaluation_id = i.id,
  evaluation_period_id = i.evaluation_period_id
FROM inserted_evaluations i
INNER JOIN source_history s ON s.employee_id = i.evaluatee_id
WHERE h.id = s.history_id;

COMMIT;
