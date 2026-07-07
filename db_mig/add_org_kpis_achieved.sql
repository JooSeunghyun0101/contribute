-- add_org_kpis_achieved.sql
-- KPI 실적을 과업 배분(task_kpi_allocations) 합산이 아니라 KPI 에 직접 입력하는 모델로 전환.
-- (사용자 결정 2026-07-02: 과업 배분 기능 제거 — KPI 만 별도 관리. 트리 롤업은 유지:
--  부모 진척 = 자식 실적 합산 + 부모 자체 실적. 배분 테이블은 비파괴 보존하되 미사용.)
-- 적용: Get-Content db_mig\add_org_kpis_achieved.sql -Raw | docker exec -i hr-evaluation-db psql -U postgres -d human-resource

ALTER TABLE org_kpis
  ADD COLUMN IF NOT EXISTS achieved_value numeric;

COMMENT ON COLUMN org_kpis.achieved_value IS 'KPI 실적(직접 입력). NULL=미입력. 트리 롤업 시 자식 실적과 합산. 낮을수록좋음(direction=lower) 판정에도 사용.';
