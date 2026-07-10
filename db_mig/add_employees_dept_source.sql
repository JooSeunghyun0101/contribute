-- add_employees_dept_source.sql
-- 부서ID(department_id)의 '출처' 추적 — 대상자 업로드에도 부서ID 열을 추가하면서(평가자 전용 인원의
-- 부서ID 입력 경로 확보: 예. 직원02) 두 파일이 충돌할 때의 우선순위를 데이터로 보장한다.
--   1순위 = 매칭 업로드('matching'), 2순위 = 대상자 업로드('profile').
--   매칭이 넣은 값은 대상자 업로드가 덮지 못하고, 매칭 업로드는 항상 갱신한다(순서 무관 매칭 승).
-- 기존 department_id 값은 전부 매칭 업로드에서 온 것이므로 'matching'으로 백필.
-- 적용: Get-Content db_mig\add_employees_dept_source.sql -Raw | docker exec -i hr-evaluation-db psql -U postgres -d human-resource

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS department_id_source text;

UPDATE employees
   SET department_id_source = 'matching'
 WHERE department_id IS NOT NULL AND department_id_source IS NULL;

COMMENT ON COLUMN employees.department_id_source IS 'department_id 출처: matching(매칭 업로드, 1순위) | profile(대상자 업로드, 2순위) | NULL(미설정). 충돌 시 matching 우선.';
