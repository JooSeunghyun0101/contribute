-- 2026-07-13 사용자관리 업로드 파이프라인 정합성 (P1) — docs/USER_MGMT_DATA_AUDIT_20260713.md §5
-- 사전점검(적용 시점): import 배치 NULL 기간 0건 · 유니크 위반 0건 · evaluations NULL 기간 0건.
-- 백업: db_mig/backups/pre_20260713_period_pipeline.json (evaluation_periods, *_import_batches)
BEGIN;

-- 1) 평가기간 단일 active + is_default 이동 — 2025는 완료 연도(closed), 2026이 기본.
--    is_default 는 employees.org_* 파생 기준이라 2025에 남아 있으면
--    2026 조직 업로드가 마스터에 반영되지 않는 실버그의 원인이었다.
UPDATE evaluation_periods SET status = 'closed', is_default = false WHERE code = '2025-annual';
UPDATE evaluation_periods SET is_default = true WHERE code = '2026-annual';

-- 2) 임포트 배치의 기간 귀속 강제 — nullable·FK 없음이라 기간 미지정/유령 기간 배치가
--    스키마상 허용되던 것을 차단(다운로드 기간 필터가 배치를 못 찾는 원인 봉쇄).
ALTER TABLE matching_import_batches
  ALTER COLUMN evaluation_period_id SET NOT NULL;
ALTER TABLE matching_import_batches
  ADD CONSTRAINT fk_matching_import_batches_period
  FOREIGN KEY (evaluation_period_id) REFERENCES evaluation_periods(id) ON DELETE RESTRICT;

ALTER TABLE employee_profile_import_batches
  ALTER COLUMN evaluation_period_id SET NOT NULL;
ALTER TABLE employee_profile_import_batches
  ADD CONSTRAINT fk_profile_import_batches_period
  FOREIGN KEY (evaluation_period_id) REFERENCES evaluation_periods(id) ON DELETE RESTRICT;

-- 3) '한 직원의 한 기간' 중복 가드 — 발령(단계별 복수 행, assignment_history_id 상이)과
--    공존하도록 (직원, 기간, 단계) 단위 부분 유니크. baseline(단계 NULL)은 제로 UUID 로
--    한 버킷에 모아 인당 1행만 허용. cancelled 행은 이력 보존을 위해 제외.
CREATE UNIQUE INDEX ux_evaluations_active_stage
  ON evaluations (
    evaluatee_id,
    evaluation_period_id,
    COALESCE(assignment_history_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE record_status = 'active';

COMMIT;
