-- 2026-07-13 (2차) ux_evaluations_active_stage 범위 축소 — 적대적 리뷰 확정 결함 수정.
--
-- 문제: 1차 인덱스의 COALESCE(assignment_history_id, 제로UUID) 'NULL 버킷'이
-- 정상 흐름 4곳과 충돌(23505·전체 롤백, 라이브 재현됨):
--   ① POST /api/admin/reset/period — 삭제 전 UPDATE ... SET assignment_history_id=NULL 로
--      한 직원의 복수 active 행(발령 단계)이 NULL 버킷에서 즉시 충돌
--   ② DELETE /api/evaluation-periods/:id — 동일 패턴
--   ③ PUT /api/employee/:id 평가자 지정 — createDraftEvaluationForEmployeeAssignment 가
--      NULL로 INSERT 후 나중에 링크(기존 baseline 있으면 충돌)
--   ④ 매칭 reconcile pass4 — 과업 실린 baseline(NULL) 잔존 시 신규 단계 INSERT(NULL) 충돌
--
-- 수정: NULL(baseline)은 인덱스 범위에서 제외하고, 실질 가드 가치가 있는
-- "한 배정 단계(assignment_history_id) → active 평가행 1개"만 강제한다.
-- baseline 중복 억제는 종전대로 앱 로직·트리거의 사전 존재 확인이 담당(인덱스 도입 전과 동일).
BEGIN;

DROP INDEX IF EXISTS ux_evaluations_active_stage;

CREATE UNIQUE INDEX ux_evaluations_active_history
  ON evaluations (assignment_history_id)
  WHERE record_status = 'active' AND assignment_history_id IS NOT NULL;

COMMIT;
