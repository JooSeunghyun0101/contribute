-- 매칭 파일로 들어온 평가자 변경 이력의 changed_at 을
-- 업로드 시각이 아니라 매칭 파일에 적힌 work_start_date 로 보정한다.
--
-- 대상: reason 이 'Matching import: <파일명>' 또는 'Matching baseline import: <파일명>' 인 행.
--      (과거 투어 'Matching past tour:' 는 import 시점에 이미 work_start_date 가 반영되므로 제외)
--
-- 같은 파일명이 여러 번 업로드된 경우 batch.created_at 이 현재 changed_at 에 가장 가까운
-- 배치를 매칭해 본래 의도된 1:1 매핑을 복원한다.
--
-- 이미 올바른 값으로 들어가 있는 행은 건너뛴다 (idempotent).

BEGIN;

WITH matched AS (
  SELECT DISTINCT ON (h.id)
    h.id AS history_id,
    mir.work_start_date::timestamptz AS new_changed_at
  FROM evaluator_assignment_history h
  JOIN matching_import_batches mib
    ON (h.reason = 'Matching import: ' || mib.source_file_name
        OR h.reason = 'Matching baseline import: ' || mib.source_file_name)
  JOIN matching_import_rows mir
    ON mir.batch_id = mib.id
   AND mir.employee_id = h.employee_id
   AND mir.evaluator_id IS NOT DISTINCT FROM h.new_evaluator_id
   AND mir.is_primary = true
   AND mir.work_start_date IS NOT NULL
  WHERE h.change_type = 'change'
  ORDER BY h.id, ABS(EXTRACT(EPOCH FROM (mib.created_at - h.changed_at))) ASC
)
UPDATE evaluator_assignment_history h
SET changed_at = matched.new_changed_at
FROM matched
WHERE h.id = matched.history_id
  AND h.changed_at <> matched.new_changed_at;

COMMIT;
