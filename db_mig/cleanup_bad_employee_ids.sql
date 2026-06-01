BEGIN;

-- 사번이 영문자로 시작하는 잘못된 직원 데이터와 그에 묶인 모든 종속 데이터를 정리한다.
-- admin 계정은 제외.
-- 일회성 데이터 클렌징 스크립트.

CREATE TEMP TABLE bad_emp AS
SELECT employee_id
FROM public.employees
WHERE employee_id ~ '^[A-Za-z]'
  AND employee_id <> 'admin';

-- bad emp 가 피평가자인 evaluation 목록
CREATE TEMP TABLE bad_evaluations AS
SELECT id
FROM public.evaluations
WHERE evaluatee_id IN (SELECT employee_id FROM bad_emp);

-- 1) 피드백 이력 (evaluator_id FK + evaluation 경유)
DELETE FROM public.feedback_history
WHERE evaluator_id IN (SELECT employee_id FROM bad_emp)
   OR evaluation_id IN (SELECT id FROM bad_evaluations);

-- 2) 과업 평가 입력 (evaluator_id FK + evaluation 경유)
DELETE FROM public.task_evaluation_entries
WHERE evaluator_id IN (SELECT employee_id FROM bad_emp)
   OR evaluation_id IN (SELECT id FROM bad_evaluations);

-- 3) 과업 (evaluation 경유)
DELETE FROM public.tasks
WHERE evaluation_id IN (SELECT id FROM bad_evaluations);

-- 4) 평가자 변경 이력
DELETE FROM public.evaluator_assignment_history
WHERE employee_id IN (SELECT employee_id FROM bad_emp)
   OR previous_evaluator_id IN (SELECT employee_id FROM bad_emp)
   OR new_evaluator_id IN (SELECT employee_id FROM bad_emp);

-- 5) 알림
DELETE FROM public.notifications
WHERE recipient_id IN (SELECT employee_id FROM bad_emp)
   OR sender_id IN (SELECT employee_id FROM bad_emp);

-- 6) 최종 평가 결과
DELETE FROM public.final_assessment
WHERE evaluation_id IN (SELECT id FROM bad_evaluations);

-- 7) 감사 로그
DELETE FROM public.admin_audit_logs
WHERE actor_id IN (SELECT employee_id FROM bad_emp)
   OR target_employee_id IN (SELECT employee_id FROM bad_emp);

-- 8) 임포트 배치/행 (imported_by FK)
DELETE FROM public.employee_profile_import_rows
WHERE batch_id IN (
  SELECT id FROM public.employee_profile_import_batches
  WHERE imported_by IN (SELECT employee_id FROM bad_emp)
);
DELETE FROM public.employee_profile_import_batches
WHERE imported_by IN (SELECT employee_id FROM bad_emp);

DELETE FROM public.matching_import_rows
WHERE batch_id IN (
  SELECT id FROM public.matching_import_batches
  WHERE imported_by IN (SELECT employee_id FROM bad_emp)
);
DELETE FROM public.matching_import_batches
WHERE imported_by IN (SELECT employee_id FROM bad_emp);

-- 9) 평가
DELETE FROM public.evaluations
WHERE evaluatee_id IN (SELECT employee_id FROM bad_emp);

-- 10) 다른 직원이 bad employee 를 평가자로 등록한 흔적 정리
UPDATE public.employees
SET evaluator_id = NULL, updated_at = NOW()
WHERE evaluator_id IN (SELECT employee_id FROM bad_emp);

-- 11) 마지막으로 employees 삭제
DELETE FROM public.employees
WHERE employee_id IN (SELECT employee_id FROM bad_emp);

DROP TABLE bad_evaluations;
DROP TABLE bad_emp;

COMMIT;
