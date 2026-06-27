-- 2025 기여도 평가(마감 연도) status 보정:
-- 실데이터 로더가 모든 평가를 'draft'로 적재해, 대시보드의 '확정' 기준 집계에서 2025가
-- 0 완료로 보이는 문제. 2025 기간에서 "과업이 1개 이상이고 전 과업이 채점 완료"된 평가만
-- 'completed'로 승격한다. 채점이 덜 된(실제 미완료) 평가는 건드리지 않는다.
--
-- 멱등: 이미 completed/locked 인 행은 영향 없음(WHERE status='draft').
-- 적용: docker exec -i hr-evaluation-db psql -U okholdings -d human-resource < 이 파일

BEGIN;

UPDATE evaluations e
SET evaluation_status = 'completed',
    updated_at = now()
WHERE e.evaluation_period_id = '8dd010d4-27c2-48e0-b371-5766b6417e64'  -- 2025 기여도 평가
  AND e.evaluation_status = 'draft'
  AND COALESCE(e.record_status, 'active') = 'active'
  -- 과업이 1개 이상 존재
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.evaluation_id = e.id AND t.deleted_at IS NULL
  )
  -- 채점 안 된 과업이 하나도 없음(= 전 과업 채점 완료)
  AND NOT EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.evaluation_id = e.id AND t.deleted_at IS NULL AND t.score IS NULL
  );

COMMIT;
