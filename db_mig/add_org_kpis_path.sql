-- add_org_kpis_path.sql
-- KPI 조직을 '레벨 내 이름 1개'가 아니라 상위 경로(법인›본부›부)까지 저장 — 동명 조직(법인 간 같은 팀명) 구분.
-- org_key 는 기존대로 해당 레벨의 조직명, org_path_* 는 그보다 상위 레벨의 조상 조직명(해당 없으면 NULL).
--   예) 팀 KPI: org_key='경영지원팀', org_path_corporation='OK저축은행', org_path_division='경영지원본부', org_path_department='경영지원부'
--       법인 KPI: org_key='OK저축은행', 경로 컬럼 전부 NULL
-- 기존 행은 NULL 유지(이름 단독 매칭으로 하위호환). 새 등록 폼은 정형화 드롭다운으로 항상 경로를 채운다.
-- 적용: Get-Content db_mig\add_org_kpis_path.sql -Raw | docker exec -i hr-evaluation-db psql -U postgres -d human-resource

ALTER TABLE org_kpis
  ADD COLUMN IF NOT EXISTS org_path_corporation text,
  ADD COLUMN IF NOT EXISTS org_path_division    text,
  ADD COLUMN IF NOT EXISTS org_path_department  text;

COMMENT ON COLUMN org_kpis.org_path_corporation IS 'org_level 상위의 법인명(레벨이 corporation이면 NULL). 후보 매칭·배분 검증 시 evaluatee_org_corporation 과 대조(NULL=이름 단독 매칭 하위호환).';
COMMENT ON COLUMN org_kpis.org_path_division    IS 'org_level 상위의 본부명(레벨이 division 이상이면 NULL).';
COMMENT ON COLUMN org_kpis.org_path_department  IS 'org_level 상위의 부명(레벨이 department 이상이면 NULL).';
