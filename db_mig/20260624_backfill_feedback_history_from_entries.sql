-- 피드백 이력 백필:
-- UI(피드백 이력/평가자 코멘트)는 feedback_history 테이블을 읽는데, 실데이터 로더가
-- 피드백을 task_evaluation_entries(.feedback)에만 넣고 feedback_history 를 비워둬서
-- "0건 / 피드백 이력이 아직 없습니다"로 보이는 문제.
-- 취소되지 않은(active) 엔트리 중 피드백이 있는 것을 feedback_history 로 옮긴다.
--
-- 멱등: 이미 같은 엔트리로 만들어진 feedback_history 행이 있으면 건너뜀.
-- 적용: docker exec -i hr-evaluation-db psql -U okholdings -d human-resource < 이 파일

BEGIN;

INSERT INTO feedback_history (
  id, task_id, content, evaluator_name, created_at,
  task_uuid, evaluation_id, evaluator_id, task_evaluation_entry_id, status
)
SELECT
  gen_random_uuid(),
  te.task_id,
  te.feedback,
  te.evaluator_name,
  COALESCE(te.feedback_date, te.created_at),
  te.task_uuid,
  te.evaluation_id,
  te.evaluator_id,
  te.id,
  'active'
FROM task_evaluation_entries te
WHERE te.feedback IS NOT NULL
  AND te.feedback <> ''
  AND COALESCE(te.status, 'active') <> 'cancelled'
  AND NOT EXISTS (
    SELECT 1 FROM feedback_history fh
    WHERE fh.task_evaluation_entry_id = te.id
  );

COMMIT;
