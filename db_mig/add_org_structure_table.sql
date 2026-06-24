-- add_org_structure_table.sql
-- 조직정보(부서코드 → 법인/본부/부/팀) 참조 테이블.
-- HR이 조직구조 엑셀(T-Level 트리)을 업로드하면 여기에 보존하고,
-- employees.org_* 를 employee.department_id 매칭으로 자동 갱신한다.
-- 적용: docker exec -i hr-evaluation-db psql -U okholdings -d human-resource < db_mig/add_org_structure_table.sql

CREATE TABLE IF NOT EXISTS org_structure (
  dept_code         text PRIMARY KEY,
  dept_name         text,
  org_corporation   text,   -- 법인(약어)
  org_division      text,   -- 본부
  org_department    text,   -- 부
  org_team          text,   -- 팀
  t_level           int,
  kind              text,   -- 조직종류(대표/본부/부/팀/지점 …)
  source_label      text,   -- 업로드 파일/스냅샷 라벨 (예: 조직_260617)
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE org_structure IS '부서코드 → 4단계 조직(법인/본부/부/팀) 참조. 조직구조 엑셀 업로드로 갱신.';
