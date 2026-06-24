-- add_evaluation_period_org.sql
-- Option B: 각 평가(evaluation)에 그 기간의 부서코드·상위조직(법인/본부/부/팀) 저장.
-- 부서 그룹핑을 employee.org_*(현재) 대신 그 평가 기간 기준으로 정확화하기 위함.
-- 적용:  docker exec -i hr-evaluation-db psql -U okholdings -d human-resource < db_mig/add_evaluation_period_org.sql
--   (또는 DATABASE_URL 로 psql 접속 후 실행)

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS evaluatee_dept_code       text,
  ADD COLUMN IF NOT EXISTS evaluatee_org_corporation text,
  ADD COLUMN IF NOT EXISTS evaluatee_org_division    text,
  ADD COLUMN IF NOT EXISTS evaluatee_org_department  text,
  ADD COLUMN IF NOT EXISTS evaluatee_org_team        text;

-- 전사현황·부서별 그룹핑/필터 가속
CREATE INDEX IF NOT EXISTS idx_eval_period_org
  ON evaluations (evaluation_period_id, evaluatee_org_corporation, evaluatee_org_division, evaluatee_org_department, evaluatee_org_team);

COMMENT ON COLUMN evaluations.evaluatee_dept_code       IS '그 평가 기간의 피평가자 부서코드(2025=발령이력/마스터, 2026=기여도)';
COMMENT ON COLUMN evaluations.evaluatee_org_corporation IS '그 기간 법인(약어)';
COMMENT ON COLUMN evaluations.evaluatee_org_division    IS '그 기간 본부';
COMMENT ON COLUMN evaluations.evaluatee_org_department  IS '그 기간 부';
COMMENT ON COLUMN evaluations.evaluatee_org_team        IS '그 기간 팀';
