-- add_org_structure_period.sql
-- org_structure 를 '평가기간별' 스냅샷으로 재설계.
-- 조직구조는 시점마다 다르므로(예: 25 회계본부 → 26 AX회계본부) 평가기간마다 별도 보존.
-- 기여도 업로드/그룹핑은 그 기간의 스냅샷으로 부서코드→상위조직을 매핑한다.
-- 적용: docker exec -i hr-evaluation-db psql -U okholdings -d human-resource < db_mig/add_org_structure_period.sql
-- (직전 add_org_structure_table.sql 의 단일 스냅샷 테이블을 대체. 데이터는 업로드/재적재로 채움.)

DROP TABLE IF EXISTS org_structure;

CREATE TABLE org_structure (
  dept_code            text NOT NULL,
  evaluation_period_id uuid NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
  dept_name            text,
  org_corporation      text,
  org_division         text,
  org_department       text,
  org_team             text,
  t_level              int,
  kind                 text,
  source_label         text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dept_code, evaluation_period_id)
);

COMMENT ON TABLE org_structure IS '평가기간별 부서코드 → 4단계 조직(법인/본부/부/팀) 참조. 조직구조 엑셀 업로드(기간 지정)로 갱신.';
COMMENT ON COLUMN org_structure.evaluation_period_id IS '이 조직 스냅샷이 적용되는 평가기간';
