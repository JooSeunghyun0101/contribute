-- add_audit_log_identity_snapshot.sql
-- 감사 로그(admin_audit_logs)를 직원 명부(employees) 생명주기와 분리한다.
--
-- 배경/문제:
--   admin_audit_logs.actor_id, target_employee_id 는 employees(employee_id) 를
--   FK(ON DELETE SET NULL)로 참조했다. 그래서 '대상자 일괄삭제(전체 초기화)'로
--   직원이 삭제되면 감사 행의 행위자·대상자 ID 가 NULL 로 날아갔고,
--   화면 이름은 read-time JOIN 이라 함께 사라져 '누가/누구에게'가 통째로 소실됐다.
--   (사용자 요구: 감사 로그는 그대로 보존하고, 초기화 이전 시점의 행위자·대상자를 살려야 한다.)
--
-- 해결:
--   1) actor_name, target_employee_name 스냅샷 컬럼 추가 — 쓰기 시점 이름을 박제.
--   2) employees FK 2개 제거 — 감사 로그는 append-only 스냅샷이라 직원 삭제와 무관하게 ID 보존.
--   3) 기존 행의 이름을 지금(직원이 남아있는 동안) 백필.
--
-- 조회(server.js /api/audit-logs)는 COALESCE(스냅샷, employees JOIN) 이므로,
-- 이 마이그레이션 적용 후 직원이 삭제돼도 스냅샷 이름이 계속 표시된다.
--
-- 적용:
--   docker exec -i hr-evaluation-db psql -U okholdings -d human-resource < db_mig/add_audit_log_identity_snapshot.sql
-- (재적용 안전 — 멱등. 서버 부팅 시 ensureRuntimeSchema 도 컬럼 추가·FK 제거를 동일하게 보강한다.)

BEGIN;

-- 1) 이름 스냅샷 컬럼
ALTER TABLE public.admin_audit_logs
  ADD COLUMN IF NOT EXISTS actor_name           text,
  ADD COLUMN IF NOT EXISTS target_employee_name text;

-- 2) employees FK 제거(직원 삭제가 감사 행의 ID 를 NULL 로 만들지 않도록).
--    감사 로그는 삭제된 직원의 사번을 '있던 그대로' 보존해야 하는 불변 기록이다.
ALTER TABLE public.admin_audit_logs DROP CONSTRAINT IF EXISTS fk_admin_audit_logs_actor;
ALTER TABLE public.admin_audit_logs DROP CONSTRAINT IF EXISTS fk_admin_audit_logs_target_employee;

-- 3) 기존 행 백필(직원이 아직 남아있는 동안 현재 이름을 박제; 이미 채워진 행은 건너뜀).
UPDATE public.admin_audit_logs a
   SET actor_name = e.name
  FROM public.employees e
 WHERE a.actor_name IS NULL
   AND a.actor_id = e.employee_id;

UPDATE public.admin_audit_logs a
   SET target_employee_name = e.name
  FROM public.employees e
 WHERE a.target_employee_name IS NULL
   AND a.target_employee_id = e.employee_id;

COMMIT;
