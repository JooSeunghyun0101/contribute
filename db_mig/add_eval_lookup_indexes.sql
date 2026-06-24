-- add_eval_lookup_indexes.sql
-- 자주 쓰는 조회 키 인덱스 보강. 기존 인덱스 현황(pg_indexes) 확인 후 '실제 누락분'만 추가.
-- 적용: docker exec -i hr-evaluation-db psql -U okholdings -d human-resource < db_mig/add_eval_lookup_indexes.sql
--
-- employees.evaluator_id : 행단위 접근가드(canAccessEmployeeEvaluations)·by-employee 조인에서
--                          매 요청 사용되나 인덱스가 없었음(org_*·batch 인덱스만 존재).
-- evaluations.evaluatee_id: 피평가자별 평가 조회(GET /api/evaluations/by-employee 등)의 핵심 필터인데
--                          단독 인덱스가 없었음(idx_eval_period_org 는 evaluation_period_id 선행이라 미해당).

CREATE INDEX IF NOT EXISTS idx_employees_evaluator_id ON employees (evaluator_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_evaluatee_id ON evaluations (evaluatee_id);
