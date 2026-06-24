-- ============================================================
-- HR Evaluation System - Local Development DB Init Script
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLE DEFINITIONS
-- ============================================================

CREATE TABLE public.employees (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id text NOT NULL UNIQUE,
  name text NOT NULL,
  position text NOT NULL,
  department text NOT NULL,
  department_id text,
  growth_level integer,
  evaluator_id text,
  available_roles text[] NOT NULL DEFAULT '{evaluatee}'::text[],
  org_sequence text,
  work_start_date date,
  work_end_date date,
  evaluation_type text,
  matching_result text,
  confirmer_id text,
  confirmer_name text,
  last_matching_batch_id uuid,
  evaluation_group_id text,
  evaluation_group_name text,
  job_role text,
  target_status text,
  last_profile_batch_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT employees_pkey PRIMARY KEY (id)
);

CREATE TABLE public.matching_import_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_file_name text NOT NULL,
  source_sheet_name text,
  imported_by text,
  row_count integer NOT NULL DEFAULT 0,
  applied_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'applied' CHECK (status = ANY (ARRAY['applied'::text, 'failed'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matching_import_batches_pkey PRIMARY KEY (id)
);

CREATE TABLE public.matching_import_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  row_number integer NOT NULL,
  employee_id text,
  employee_name text,
  org_sequence text,
  department_id text,
  department_name text,
  work_start_date date,
  work_end_date date,
  evaluator_id text,
  evaluator_name text,
  confirmer_id text,
  confirmer_name text,
  evaluation_type text,
  matching_result text,
  is_primary boolean NOT NULL DEFAULT false,
  validation_status text NOT NULL DEFAULT 'valid' CHECK (validation_status = ANY (ARRAY['valid'::text, 'warning'::text, 'error'::text])),
  validation_message text,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matching_import_rows_pkey PRIMARY KEY (id),
  CONSTRAINT uq_matching_import_rows_batch_row UNIQUE (batch_id, row_number)
);

CREATE TABLE public.employee_profile_import_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_file_name text NOT NULL,
  source_sheet_names text[] NOT NULL DEFAULT ARRAY[]::text[],
  imported_by text,
  row_count integer NOT NULL DEFAULT 0,
  applied_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'applied' CHECK (status = ANY (ARRAY['applied'::text, 'failed'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_profile_import_batches_pkey PRIMARY KEY (id)
);

CREATE TABLE public.employee_profile_import_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  sheet_name text NOT NULL,
  row_number integer NOT NULL,
  evaluation_group text,
  evaluation_group_id text,
  evaluation_group_name text,
  employee_id text,
  employee_name text,
  org_sequence text,
  department_id text,
  department_name text,
  work_start_date date,
  work_end_date date,
  growth_level integer,
  growth_level_label text,
  position text,
  job_role text,
  evaluator_id text,
  evaluator_name text,
  evaluator_position text,
  target_status text,
  available_roles text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_primary boolean NOT NULL DEFAULT false,
  validation_status text NOT NULL DEFAULT 'valid' CHECK (validation_status = ANY (ARRAY['valid'::text, 'warning'::text, 'error'::text])),
  validation_message text,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_profile_import_rows_pkey PRIMARY KEY (id),
  CONSTRAINT uq_employee_profile_import_rows_batch_sheet_row UNIQUE (batch_id, sheet_name, row_number)
);

CREATE TABLE public.evaluation_periods (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  evaluation_year integer NOT NULL,
  starts_on date,
  ends_on date,
  status text NOT NULL DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft'::text, 'active'::text, 'closed'::text, 'locked'::text])),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_periods_pkey PRIMARY KEY (id)
);

CREATE TABLE public.evaluations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evaluatee_id text NOT NULL,
  evaluatee_name text NOT NULL,
  evaluatee_position text NOT NULL,
  evaluatee_department text NOT NULL,
  growth_level integer NOT NULL,
  evaluation_status text NOT NULL CHECK (evaluation_status = ANY (ARRAY['draft'::text, 'submitted'::text, 'evaluating'::text, 'completed'::text, 'locked'::text, 'in-progress'::text])),
  last_modified timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  evaluation_year integer NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  evaluation_period_id uuid,
  assignment_history_id uuid,
  record_status text NOT NULL DEFAULT 'active' CHECK (record_status = ANY (ARRAY['active'::text, 'cancelled'::text])),
  CONSTRAINT evaluations_pkey PRIMARY KEY (id),
  CONSTRAINT uq_evaluations_id_year UNIQUE (id, evaluation_year)
);

CREATE TABLE public.evaluator_assignment_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id text NOT NULL,
  previous_evaluator_id text,
  new_evaluator_id text,
  evaluation_id uuid,
  evaluation_period_id uuid,
  change_type text NOT NULL DEFAULT 'change' CHECK (change_type = ANY (ARRAY['change'::text, 'cancel'::text])),
  status text NOT NULL DEFAULT 'applied' CHECK (status = ANY (ARRAY['applied'::text, 'cancelled'::text])),
  reason text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text,
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text,
  supersedes_history_id uuid,
  CONSTRAINT evaluator_assignment_history_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id text NOT NULL,
  evaluation_id uuid NOT NULL,
  title text NOT NULL,
  weight integer DEFAULT 0,
  description text,
  start_date date,
  end_date date,
  contribution_method text,
  contribution_scope text,
  score integer,
  feedback text,
  feedback_date timestamptz,
  evaluator_name text,
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  evaluation_year integer NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  evaluation_period_id uuid,
  CONSTRAINT tasks_pkey PRIMARY KEY (id),
  CONSTRAINT uq_tasks_task_id UNIQUE (task_id)
);

CREATE TABLE public.task_evaluation_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_uuid uuid NOT NULL,
  task_id text NOT NULL,
  evaluation_id uuid NOT NULL,
  evaluator_id text NOT NULL,
  evaluator_name text NOT NULL,
  assignment_history_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'cancelled'::text])),
  contribution_method text,
  contribution_scope text,
  score integer,
  feedback text,
  feedback_date timestamptz,
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_evaluation_entries_pkey PRIMARY KEY (id),
  CONSTRAINT uq_task_evaluation_entries_task_evaluator UNIQUE (task_uuid, evaluator_id)
);

CREATE TABLE public.feedback_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id text NOT NULL,
  task_uuid uuid,
  evaluation_id uuid,
  evaluator_id text,
  task_evaluation_entry_id uuid,
  content text NOT NULL,
  evaluator_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'cancelled'::text])),
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT feedback_history_pkey PRIMARY KEY (id)
);

CREATE TABLE public.final_assessment (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  final_assessment_id text NOT NULL,
  evaluation_id uuid NOT NULL,
  evaluation_year integer,
  contribution_method text,
  contribution_scope text,
  growth_level integer,
  feedback text,
  feedback_date timestamptz,
  evaluator_name text,
  created_at timestamptz DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT final_assessment_pkey PRIMARY KEY (id),
  CONSTRAINT uq_final_assessment_id UNIQUE (final_assessment_id)
);

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  notification_type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  priority text NOT NULL CHECK (priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])),
  sender_id text NOT NULL,
  sender_name text NOT NULL,
  recipient_id text NOT NULL,
  related_evaluation_id uuid,
  related_task_id text,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  related_final_assessment_id text,
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);

CREATE TABLE public.settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  setting_type text NOT NULL,
  setting_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT settings_pkey PRIMARY KEY (id),
  CONSTRAINT settings_user_type_unique UNIQUE (user_id, setting_type)
);

CREATE TABLE public.admin_audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  actor_id text,
  target_employee_id text,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id)
);

CREATE TABLE public.prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  content text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- FOREIGN KEY CONSTRAINTS
-- ============================================================

ALTER TABLE public.employees
  ADD CONSTRAINT fk_employees_evaluator
  FOREIGN KEY (evaluator_id) REFERENCES public.employees(employee_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.employees
  ADD CONSTRAINT fk_employees_last_matching_batch
  FOREIGN KEY (last_matching_batch_id) REFERENCES public.matching_import_batches(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.matching_import_batches
  ADD CONSTRAINT fk_matching_import_batches_imported_by
  FOREIGN KEY (imported_by) REFERENCES public.employees(employee_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.matching_import_rows
  ADD CONSTRAINT fk_matching_import_rows_batch
  FOREIGN KEY (batch_id) REFERENCES public.matching_import_batches(id)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.employees
  ADD CONSTRAINT fk_employees_last_profile_batch
  FOREIGN KEY (last_profile_batch_id) REFERENCES public.employee_profile_import_batches(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.employee_profile_import_batches
  ADD CONSTRAINT fk_employee_profile_import_batches_imported_by
  FOREIGN KEY (imported_by) REFERENCES public.employees(employee_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.employee_profile_import_rows
  ADD CONSTRAINT fk_employee_profile_import_rows_batch
  FOREIGN KEY (batch_id) REFERENCES public.employee_profile_import_batches(id)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.evaluations
  ADD CONSTRAINT fk_evaluations_evaluatee
  FOREIGN KEY (evaluatee_id) REFERENCES public.employees(employee_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.evaluations
  ADD CONSTRAINT fk_evaluations_period
  FOREIGN KEY (evaluation_period_id) REFERENCES public.evaluation_periods(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.evaluations
  ADD CONSTRAINT fk_evaluations_assignment_history
  FOREIGN KEY (assignment_history_id) REFERENCES public.evaluator_assignment_history(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.evaluator_assignment_history
  ADD CONSTRAINT fk_evaluator_assignment_history_evaluation
  FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.evaluator_assignment_history
  ADD CONSTRAINT fk_evaluator_assignment_history_period
  FOREIGN KEY (evaluation_period_id) REFERENCES public.evaluation_periods(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_evaluation
  FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_period
  FOREIGN KEY (evaluation_period_id) REFERENCES public.evaluation_periods(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.task_evaluation_entries
  ADD CONSTRAINT fk_task_evaluation_entries_task_uuid
  FOREIGN KEY (task_uuid) REFERENCES public.tasks(id)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.task_evaluation_entries
  ADD CONSTRAINT fk_task_evaluation_entries_task_id
  FOREIGN KEY (task_id) REFERENCES public.tasks(task_id)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.task_evaluation_entries
  ADD CONSTRAINT fk_task_evaluation_entries_evaluation
  FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id)
  ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE public.task_evaluation_entries
  ADD CONSTRAINT fk_task_evaluation_entries_assignment_history
  FOREIGN KEY (assignment_history_id) REFERENCES public.evaluator_assignment_history(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.feedback_history
  ADD CONSTRAINT fk_feedback_task
  FOREIGN KEY (task_id) REFERENCES public.tasks(task_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.feedback_history
  ADD CONSTRAINT fk_feedback_history_task_uuid
  FOREIGN KEY (task_uuid) REFERENCES public.tasks(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.feedback_history
  ADD CONSTRAINT fk_feedback_history_evaluation
  FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.feedback_history
  ADD CONSTRAINT fk_feedback_history_evaluator
  FOREIGN KEY (evaluator_id) REFERENCES public.employees(employee_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.feedback_history
  ADD CONSTRAINT fk_feedback_history_task_evaluation_entry
  FOREIGN KEY (task_evaluation_entry_id) REFERENCES public.task_evaluation_entries(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.final_assessment
  ADD CONSTRAINT fk_final_assessment_evaluations
  FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id);

ALTER TABLE public.notifications
  ADD CONSTRAINT fk_notifications_evaluation
  FOREIGN KEY (related_evaluation_id) REFERENCES public.evaluations(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public.notifications
  ADD CONSTRAINT fk_notifications_final_assessment
  FOREIGN KEY (related_final_assessment_id) REFERENCES public.final_assessment(final_assessment_id)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public.notifications
  ADD CONSTRAINT fk_notifications_recipient
  FOREIGN KEY (recipient_id) REFERENCES public.employees(employee_id)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public.notifications
  ADD CONSTRAINT fk_notifications_sender
  FOREIGN KEY (sender_id) REFERENCES public.employees(employee_id)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public.notifications
  ADD CONSTRAINT fk_notifications_task
  FOREIGN KEY (related_task_id) REFERENCES public.tasks(task_id)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public.admin_audit_logs
  ADD CONSTRAINT fk_admin_audit_logs_actor
  FOREIGN KEY (actor_id) REFERENCES public.employees(employee_id)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE public.admin_audit_logs
  ADD CONSTRAINT fk_admin_audit_logs_target_employee
  FOREIGN KEY (target_employee_id) REFERENCES public.employees(employee_id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX idx_evaluations_period ON public.evaluations (evaluation_period_id);
CREATE INDEX idx_evaluations_record_status ON public.evaluations (record_status);
CREATE INDEX idx_evaluations_assignment_history ON public.evaluations (assignment_history_id);
CREATE INDEX idx_employees_department_id ON public.employees (department_id);
CREATE INDEX idx_employees_last_matching_batch ON public.employees (last_matching_batch_id);
CREATE INDEX idx_employees_last_profile_batch ON public.employees (last_profile_batch_id);
CREATE INDEX idx_employees_evaluation_group ON public.employees (evaluation_group_id);
CREATE INDEX idx_matching_import_batches_created ON public.matching_import_batches (created_at DESC);
CREATE INDEX idx_matching_import_rows_batch ON public.matching_import_rows (batch_id, row_number);
CREATE INDEX idx_matching_import_rows_employee ON public.matching_import_rows (employee_id);
CREATE INDEX idx_matching_import_rows_evaluator ON public.matching_import_rows (evaluator_id);
CREATE INDEX idx_matching_import_rows_primary ON public.matching_import_rows (batch_id, is_primary);
CREATE INDEX idx_employee_profile_import_batches_created ON public.employee_profile_import_batches (created_at DESC);
CREATE INDEX idx_employee_profile_import_rows_batch ON public.employee_profile_import_rows (batch_id, sheet_name, row_number);
CREATE INDEX idx_employee_profile_import_rows_employee ON public.employee_profile_import_rows (employee_id);
CREATE INDEX idx_employee_profile_import_rows_evaluator ON public.employee_profile_import_rows (evaluator_id);
CREATE INDEX idx_employee_profile_import_rows_group ON public.employee_profile_import_rows (evaluation_group_id);
CREATE INDEX idx_evaluator_assignment_history_employee ON public.evaluator_assignment_history (employee_id);
CREATE INDEX idx_evaluator_assignment_history_previous ON public.evaluator_assignment_history (previous_evaluator_id);
CREATE INDEX idx_evaluator_assignment_history_new ON public.evaluator_assignment_history (new_evaluator_id);
CREATE INDEX idx_evaluator_assignment_history_employee_status ON public.evaluator_assignment_history (employee_id, status, changed_at DESC);
CREATE INDEX idx_evaluator_assignment_history_period ON public.evaluator_assignment_history (evaluation_period_id);
CREATE INDEX idx_evaluator_assignment_history_supersedes ON public.evaluator_assignment_history (supersedes_history_id);
CREATE INDEX idx_tasks_period ON public.tasks (evaluation_period_id);
CREATE INDEX idx_task_evaluation_entries_evaluation ON public.task_evaluation_entries (evaluation_id);
CREATE INDEX idx_task_evaluation_entries_task ON public.task_evaluation_entries (task_uuid);
CREATE INDEX idx_task_evaluation_entries_evaluator ON public.task_evaluation_entries (evaluator_id);
CREATE INDEX idx_task_evaluation_entries_status ON public.task_evaluation_entries (status);
CREATE INDEX idx_task_evaluation_entries_assignment_history ON public.task_evaluation_entries (assignment_history_id);
CREATE INDEX idx_evaluator_assignment_history_evaluation_status ON public.evaluator_assignment_history (evaluation_id, status);
CREATE INDEX idx_feedback_history_status ON public.feedback_history (status);
CREATE INDEX idx_feedback_history_task_uuid ON public.feedback_history (task_uuid);
CREATE INDEX idx_feedback_history_evaluation ON public.feedback_history (evaluation_id);
CREATE INDEX idx_feedback_history_evaluator ON public.feedback_history (evaluator_id);
CREATE INDEX idx_feedback_history_task_evaluation_entry ON public.feedback_history (task_evaluation_entry_id);
CREATE INDEX idx_admin_audit_logs_action_type ON public.admin_audit_logs (action_type);
CREATE INDEX idx_admin_audit_logs_target_employee ON public.admin_audit_logs (target_employee_id, created_at DESC);
CREATE INDEX idx_admin_audit_logs_actor ON public.admin_audit_logs (actor_id, created_at DESC);

-- ============================================================
-- TRIGGER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_default_evaluation()
RETURNS trigger AS $$
BEGIN
  IF NOT (
    NEW.available_roles @> ARRAY['evaluatee']::text[]
    AND NEW.evaluator_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.evaluations (
    evaluatee_id,
    evaluatee_name,
    evaluatee_position,
    evaluatee_department,
    growth_level,
    evaluation_status,
    evaluation_year,
    evaluation_period_id,
    created_at,
    updated_at
  ) VALUES (
    NEW.employee_id,
    NEW.name,
    NEW.position,
    NEW.department,
    COALESCE(NEW.growth_level, 0),
    'draft',
    COALESCE(
      (SELECT evaluation_year FROM public.evaluation_periods WHERE status = 'active' ORDER BY is_default DESC, starts_on DESC NULLS LAST, created_at DESC LIMIT 1),
      EXTRACT(YEAR FROM CURRENT_DATE)
    ),
    (SELECT id FROM public.evaluation_periods WHERE status = 'active' ORDER BY is_default DESC, starts_on DESC NULLS LAST, created_at DESC LIMIT 1),
    now(),
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_default_evaluation
AFTER INSERT ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.create_default_evaluation();

CREATE OR REPLACE FUNCTION public.set_final_assessment_growth_level()
RETURNS trigger AS $$
BEGIN
  SELECT growth_level INTO NEW.growth_level
  FROM public.evaluations
  WHERE id = NEW.evaluation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_final_assessment_growth_level
BEFORE INSERT OR UPDATE ON public.final_assessment
FOR EACH ROW
EXECUTE FUNCTION public.set_final_assessment_growth_level();

CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp_on_prompt_templates
BEFORE UPDATE ON prompt_templates
FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- ============================================================
-- SEED DATA (disable trigger to avoid duplicate evaluations)
-- ============================================================

INSERT INTO public.evaluation_periods (code, name, evaluation_year, starts_on, ends_on, status, is_default) VALUES
('2026-annual', '2026 Annual Evaluation', 2026, DATE '2026-01-01', DATE '2026-12-31', 'active', true);

-- 부트스트랩 관리자 계정만 시드한다(개인정보 아님).
-- 초기 비밀번호 = 사번('admin'), 최초 로그인 시 변경 강제(server.js).
-- 실제 직원·평가 데이터는 깨끗한 상태로 기동한 뒤 내부망에서 업로드한다.
INSERT INTO public.employees (id, employee_id, name, position, department, growth_level, evaluator_id, available_roles, created_at, updated_at) VALUES
('00000000-0000-0000-0000-000000000001','admin','시스템관리자','관리자','인사부',NULL,NULL,'{hr}','2026-01-01 00:00:00+00','2026-01-01 00:00:00+00');

-- prompt_templates seed
INSERT INTO prompt_templates (key, content, description) VALUES (
  'evaluation_guide',
  '**수시 성과관리체계 가이드라인:**

**평가 철학:**
- 지속적 모니터링: 과업 진행 상황을 실시간으로 추적하고 관리
- 정기적 피드백: 수시 성과보고를 통한 양방향 소통과 개선점 도출
- 적응적 목표 조정: 변화하는 환경에 맞춰 과업과 목표를 유연하게 조정
- 성장 중심 평가: 결과뿐만 아니라 과정과 학습을 중시하는 발전적 평가

**점수 의미:**
- 평가점수는 성장레벨별 요구수준을 의미
- 성장레벨보다 평가점수가 같거나 높으면 달성
- 1점: 미흡, 2점: 보통, 3점: 양호, 4점: 우수

**기여방식:**
- 총괄: 업무 전체를 책임지고 관리, 프로젝트 전체적인 방향 설정
- 리딩: 특정 영역을 주도적으로 담당, 해당 영역의 성과에 직접 책임
- 실무: 핵심 업무 직접 수행, 업무의 질적 완성도에 기여
- 지원: 다른 구성원을 보조하고 지원, 주 담당자를 보조

**기여범위:**
- 전략적: 조직 전체에 영향, 부서를 넘어 조직 전체의 방향성이나 성과에 영향
- 상호적: 팀 단위 협업, 팀 내 다른 구성원들과 긴밀히 협력하여 공동 목표 달성
- 독립적: 자율적 업무 수행, 개인의 판단과 책임 하에 독립적으로 업무 기획하고 실행
- 의존적: 지시받은 업무 수행, 상급자나 동료의 지시나 가이드라인에 따라 업무 수행

**점수 매트릭스:**
- 총괄: 의존적(2점), 독립적(3점), 상호적(4점), 전략적(4점)
- 리딩: 의존적(2점), 독립적(3점), 상호적(3점), 전략적(4점)
- 실무: 의존적(1점), 독립적(2점), 상호적(3점), 전략적(3점)
- 지원: 의존적(1점), 독립적(1점), 상호적(2점), 전략적(2점)',
  '수시 성과관리체계 평가 가이드'
);
