-- add_org_kpis.sql
-- 조직 KPI 정렬 기능 — 정량(억/%/건) 목표를 조직 단위로 등록하고, 피평가자 과업에 배분·실적 추적.
-- 기존 정성 점수 체계(매트릭스)는 무변경. KPI는 평가 화면에서 "참고 지표"로만 강조(부분 반영).
-- 트리(parent_kpi_id): 본부 KPI(부모) ← 팀 KPI(자식) 자동 롤업. 각 과업 실적은 한 노드에 1회 귀속.
-- 적용: .env DATABASE_URL 기준 — node db_mig/run-migrations.cjs  또는
--       Get-Content db_mig\add_org_kpis.sql -Raw | docker exec -i hr-evaluation-db psql -U postgres -d human-resource

-- ── KPI 정의 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_kpis (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_period_id  uuid NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
  parent_kpi_id         uuid REFERENCES org_kpis(id) ON DELETE CASCADE,  -- NULL=최상위
  org_level             text NOT NULL,   -- 'corporation'|'division'|'department'|'team'
  org_key               text NOT NULL,   -- 그 레벨 조직명 (evaluations.evaluatee_org_* 와 매칭)
  name                  text NOT NULL,   -- 예: '기업여신 총금액'
  unit                  text NOT NULL,   -- '억'|'%'|'건'|...
  target_value          numeric NOT NULL,
  direction             text NOT NULL DEFAULT 'higher',  -- 'higher'|'lower' (높을/낮을수록 좋음)
  description           text,
  owner_id              text,            -- 책임자 employee_id (optional)
  status                text NOT NULL DEFAULT 'active',   -- 'active'|'archived'
  created_by            text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_org_kpis_level     CHECK (org_level IN ('corporation','division','department','team')),
  CONSTRAINT chk_org_kpis_direction CHECK (direction IN ('higher','lower')),
  CONSTRAINT chk_org_kpis_status    CHECK (status IN ('active','archived')),
  CONSTRAINT chk_org_kpis_target    CHECK (target_value > 0)
);

CREATE INDEX IF NOT EXISTS idx_org_kpis_period_org ON org_kpis(evaluation_period_id, org_level, org_key);
CREATE INDEX IF NOT EXISTS idx_org_kpis_parent     ON org_kpis(parent_kpi_id);

COMMENT ON TABLE  org_kpis IS '조직 KPI 정의(평가기간·조직레벨 단위). parent_kpi_id 로 본부←팀 트리 롤업.';
COMMENT ON COLUMN org_kpis.parent_kpi_id IS '상위 KPI(같은 기간·상위 레벨·같은 단위). NULL=최상위. 실적은 자식→부모 자동 합산.';
COMMENT ON COLUMN org_kpis.org_key IS '그 레벨 조직명. evaluations.evaluatee_org_<level> 와 매칭해 과업 배분 유효성 검증.';

-- ── 과업 ↔ KPI 배분/실적 ───────────────────────────────────
CREATE TABLE IF NOT EXISTS task_kpi_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id            uuid NOT NULL REFERENCES org_kpis(id) ON DELETE CASCADE,
  task_uuid         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,  -- tasks.id (PK)
  task_id           text NOT NULL,        -- tasks.task_id (조회 편의)
  evaluation_id     uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  allocated_target  numeric NOT NULL DEFAULT 0,  -- 이 과업 배분 목표 (예: 500억)
  achieved_value    numeric,              -- 실적 (NULL=미입력, 예: 420억)
  note              text,
  updated_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_task_kpi_alloc_target CHECK (allocated_target >= 0),
  CONSTRAINT uq_task_kpi_alloc UNIQUE (kpi_id, task_uuid)
);

CREATE INDEX IF NOT EXISTS idx_task_kpi_alloc_kpi  ON task_kpi_allocations(kpi_id);
CREATE INDEX IF NOT EXISTS idx_task_kpi_alloc_task ON task_kpi_allocations(task_uuid);
CREATE INDEX IF NOT EXISTS idx_task_kpi_alloc_eval ON task_kpi_allocations(evaluation_id);

COMMENT ON TABLE  task_kpi_allocations IS '과업↔KPI 배분(allocated_target)과 실적(achieved_value). 진척=Σ실적/목표, 트리 롤업.';
