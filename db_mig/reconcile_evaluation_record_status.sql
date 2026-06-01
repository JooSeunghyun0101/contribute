BEGIN;

-- 평가자 변경 취소/정정 후 evaluation.record_status 가 'cancelled' 로 남아있지만
-- 살아있는 applied 평가자 배정 이력이 있는 평가를 'active' 로 복구한다.
-- (cancelled 상태가 모든 조회 쿼리에서 task/entries 를 가리는 부작용을 해소.)
UPDATE evaluations e
SET
  record_status = 'active',
  updated_at = NOW()
WHERE record_status = 'cancelled'
  AND EXISTS (
    SELECT 1
    FROM evaluator_assignment_history h
    WHERE h.evaluation_id = e.id
      AND h.status = 'applied'
      AND h.change_type <> 'cancel'
  );

COMMIT;
