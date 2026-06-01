BEGIN;

-- 1) evaluator_assignment_history.previous_evaluator_id 보정
--    각 직원의 applied non-cancel 행들을 시간순으로 정렬해서
--    각 행의 previous_evaluator_id 를 직전 행의 new_evaluator_id 로 일관 동기화한다.
--    (정정으로 직전 평가자가 바뀌었는데 그 다음 행들이 옛 평가자를 가리키는 문제 해소)
WITH numbered AS (
  SELECT
    id,
    employee_id,
    new_evaluator_id,
    supersedes_history_id,
    changed_at,
    ROW_NUMBER() OVER (
      PARTITION BY employee_id
      ORDER BY changed_at, id
    ) AS rn
  FROM public.evaluator_assignment_history
  WHERE status = 'applied'
    AND change_type <> 'cancel'
),
expected AS (
  SELECT
    curr.id AS row_id,
    COALESCE(orig.new_evaluator_id, prev.new_evaluator_id) AS expected_previous_evaluator_id
  FROM numbered curr
  LEFT JOIN public.evaluator_assignment_history orig
    ON orig.id = curr.supersedes_history_id
  LEFT JOIN numbered prev
    ON prev.employee_id = curr.employee_id
    AND prev.rn = curr.rn - 1
)
UPDATE public.evaluator_assignment_history h
SET previous_evaluator_id = e.expected_previous_evaluator_id
FROM expected e
WHERE h.id = e.row_id
  AND h.previous_evaluator_id IS DISTINCT FROM e.expected_previous_evaluator_id;

-- 2) employees.evaluator_id 보정
--    각 직원의 가장 최근 applied non-cancel new_evaluator_id 로 마스터를 동기화한다.
UPDATE public.employees e
SET evaluator_id = latest.new_evaluator_id,
    updated_at = NOW()
FROM (
  SELECT DISTINCT ON (h.employee_id)
    h.employee_id,
    h.new_evaluator_id
  FROM public.evaluator_assignment_history h
  WHERE h.status = 'applied'
    AND h.change_type <> 'cancel'
  ORDER BY h.employee_id, h.changed_at DESC, h.id DESC
) AS latest
WHERE e.employee_id = latest.employee_id
  AND e.evaluator_id IS DISTINCT FROM latest.new_evaluator_id;

COMMIT;
