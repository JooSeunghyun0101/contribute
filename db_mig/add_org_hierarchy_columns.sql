-- 업로드 양식에 추가된 4단계 조직 계층(법인 > 본부 > 부 > 팀)을 보존한다.
-- 기존 employees.department(부서명/리프)는 그대로 두고, 상위 계층을 별도 컬럼으로 추가.
-- 컬럼명은 기존 department 와 충돌하지 않도록 org_ 접두사 사용.
BEGIN;

-- 1) 직원 마스터: 현재 소속 기준 조직 계층 (현재 소속 기준 과거이력 조회에 사용)
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS org_corporation text,  -- 법인
  ADD COLUMN IF NOT EXISTS org_division    text,  -- 본부
  ADD COLUMN IF NOT EXISTS org_department  text,  -- 부
  ADD COLUMN IF NOT EXISTS org_team        text;  -- 팀

-- 2) 프로필 업로드 행 스테이징
ALTER TABLE public.employee_profile_import_rows
  ADD COLUMN IF NOT EXISTS org_corporation text,
  ADD COLUMN IF NOT EXISTS org_division    text,
  ADD COLUMN IF NOT EXISTS org_department  text,
  ADD COLUMN IF NOT EXISTS org_team        text;

-- 3) 매칭(평가자 배정) 업로드 행 스테이징
ALTER TABLE public.matching_import_rows
  ADD COLUMN IF NOT EXISTS org_corporation text,
  ADD COLUMN IF NOT EXISTS org_division    text,
  ADD COLUMN IF NOT EXISTS org_department  text,
  ADD COLUMN IF NOT EXISTS org_team        text;

-- 조직별 집계/필터 조회 성능용 인덱스
CREATE INDEX IF NOT EXISTS idx_employees_org_corporation ON public.employees (org_corporation);
CREATE INDEX IF NOT EXISTS idx_employees_org_division    ON public.employees (org_division);
CREATE INDEX IF NOT EXISTS idx_employees_org_department  ON public.employees (org_department);
CREATE INDEX IF NOT EXISTS idx_employees_org_team        ON public.employees (org_team);

COMMIT;
