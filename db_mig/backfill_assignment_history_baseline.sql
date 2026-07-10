BEGIN;

-- evaluation 은 있지만 그 evaluation 에 연결된 applied 평가자 배정 이력이 없는 경우
-- (예: 수동 추가했지만 baseline 이력이 없어 화면에 안 보이는 직원) baseline 을 생성한다.
WITH missing AS (
  SELECT
    ev.id AS evaluation_id,
    ev.evaluatee_id,
    ev.evaluation_period_id,
    e.evaluator_id
  FROM public.evaluations ev
  JOIN public.employees e ON e.employee_id = ev.evaluatee_id
  WHERE COALESCE(ev.record_status, 'active') = 'active'
    AND e.evaluator_id IS NOT NULL
    AND e.available_roles @> ARRAY['evaluatee']::text[]
    AND NOT EXISTS (
      SELECT 1
      FROM public.evaluator_assignment_history h
      WHERE h.evaluation_id = ev.id
        AND h.status = 'applied'
        AND h.change_type <> 'cancel'
    )
)
INSERT INTO public.evaluator_assignment_history (
  employee_id, previous_evaluator_id, new_evaluator_id, changed_by,
  evaluation_id, evaluation_period_id, change_type, status, reason, changed_at
)
SELECT
  evaluatee_id, NULL, evaluator_id, NULL,
  evaluation_id, evaluation_period_id, 'change', 'applied',
  'Backfill baseline for manually added employees', NOW()
FROM missing;

-- 생성한 baseline 을 evaluation.assignment_history_id 에 연결.
UPDATE public.evaluations ev
SET assignment_history_id = h.id, updated_at = NOW()
FROM public.evaluator_assignment_history h
WHERE h.evaluation_id = ev.id
  AND ev.assignment_history_id IS NULL
  AND h.status = 'applied'
  AND h.change_type <> 'cancel'
  AND h.reason = 'Backfill baseline for manually added employees';

COMMIT;
