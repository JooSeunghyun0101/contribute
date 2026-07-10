--
-- PostgreSQL database dump
--

\restrict 8OLwjwGTJwGgEdPOpeTb4W7NabIXLPHtlQa5QNAbnDlCveiHlcfNrRcefjdNABl

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg13+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: create_default_evaluation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_default_evaluation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  active_period_id uuid;
  active_period_year integer;
BEGIN
  IF NOT (
    NEW.available_roles @> ARRAY['evaluatee']::text[]
    AND NEW.evaluator_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  SELECT id, evaluation_year
    INTO active_period_id, active_period_year
  FROM public.evaluation_periods
  WHERE status = 'active'
  ORDER BY is_default DESC, starts_on DESC NULLS LAST, created_at DESC
  LIMIT 1;

  -- 활성 평가기간이 없으면 자동 생성하지 않는다.
  IF active_period_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 같은 evaluatee + 평가기간에 이미 active evaluation 이 있으면 중복 생성하지 않는다.
  IF EXISTS (
    SELECT 1
    FROM public.evaluations
    WHERE evaluatee_id = NEW.employee_id
      AND evaluation_period_id = active_period_id
      AND COALESCE(record_status, 'active') = 'active'
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
    COALESCE(active_period_year, EXTRACT(YEAR FROM CURRENT_DATE)),
    active_period_id,
    now(),
    now()
  );
  RETURN NEW;
END;
$$;


--
-- Name: set_final_assessment_growth_level(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_final_assessment_growth_level() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  SELECT growth_level INTO NEW.growth_level
  FROM public.evaluations
  WHERE id = NEW.evaluation_id;
  RETURN NEW;
END;
$$;


--
-- Name: trigger_set_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_set_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action_type text NOT NULL,
    actor_id text,
    target_employee_id text,
    previous_value jsonb,
    new_value jsonb,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_generated_content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_generated_content (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    scope_id text NOT NULL,
    content text NOT NULL,
    generated_by text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    meta jsonb
);


--
-- Name: employee_profile_import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_profile_import_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_file_name text NOT NULL,
    source_sheet_names text[] DEFAULT ARRAY[]::text[] NOT NULL,
    imported_by text,
    row_count integer DEFAULT 0 NOT NULL,
    applied_count integer DEFAULT 0 NOT NULL,
    warning_count integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'applied'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    evaluation_period_id uuid,
    CONSTRAINT employee_profile_import_batches_status_check CHECK ((status = ANY (ARRAY['applied'::text, 'failed'::text])))
);


--
-- Name: employee_profile_import_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_profile_import_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
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
    "position" text,
    job_role text,
    evaluator_id text,
    evaluator_name text,
    evaluator_position text,
    target_status text,
    is_primary boolean DEFAULT false NOT NULL,
    validation_status text DEFAULT 'valid'::text NOT NULL,
    validation_message text,
    raw_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    available_roles text[] DEFAULT ARRAY[]::text[] NOT NULL,
    org_corporation text,
    org_division text,
    org_department text,
    org_team text,
    CONSTRAINT employee_profile_import_rows_validation_status_check CHECK ((validation_status = ANY (ARRAY['valid'::text, 'warning'::text, 'error'::text])))
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text NOT NULL,
    name text NOT NULL,
    "position" text NOT NULL,
    department text NOT NULL,
    growth_level integer,
    evaluator_id text,
    available_roles text[] DEFAULT '{evaluatee}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    department_id text,
    department_id_source text,
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
    org_corporation text,
    org_division text,
    org_department text,
    org_team text,
    password_hash text,
    must_change_password boolean DEFAULT true NOT NULL,
    ai_rule_exempt boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN employees.password_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employees.password_hash IS 'bcrypt 해시. NULL=초기 상태(초기 비밀번호=사번, 첫 로그인 시 변경 강제)';


--
-- Name: COLUMN employees.must_change_password; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.employees.must_change_password IS 'true면 로그인 직후 비밀번호 변경 강제';


--
-- Name: evaluation_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluation_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    evaluation_year integer NOT NULL,
    starts_on date,
    ends_on date,
    status text DEFAULT 'draft'::text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evaluation_periods_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'closed'::text, 'locked'::text])))
);


--
-- Name: evaluations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    evaluatee_id text NOT NULL,
    evaluatee_name text NOT NULL,
    evaluatee_position text NOT NULL,
    evaluatee_department text NOT NULL,
    growth_level integer NOT NULL,
    evaluation_status text NOT NULL,
    last_modified timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    evaluation_year integer DEFAULT EXTRACT(year FROM CURRENT_DATE) NOT NULL,
    evaluation_period_id uuid,
    assignment_history_id uuid,
    record_status text DEFAULT 'active'::text NOT NULL,
    evaluatee_dept_code text,
    evaluatee_org_corporation text,
    evaluatee_org_division text,
    evaluatee_org_department text,
    evaluatee_org_team text,
    submitted_at timestamp with time zone,
    returned_at timestamp with time zone,
    reverted_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT chk_evaluations_record_status CHECK ((record_status = ANY (ARRAY['active'::text, 'cancelled'::text]))),
    CONSTRAINT evaluations_evaluation_status_check CHECK ((evaluation_status = ANY (ARRAY['draft'::text, 'submitted'::text, 'evaluating'::text, 'completed'::text, 'locked'::text, 'in-progress'::text])))
);


--
-- Name: COLUMN evaluations.evaluatee_dept_code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluations.evaluatee_dept_code IS '그 평가 기간의 피평가자 부서코드(2025=발령이력/마스터, 2026=기여도)';


--
-- Name: COLUMN evaluations.evaluatee_org_corporation; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluations.evaluatee_org_corporation IS '그 기간 법인(약어)';


--
-- Name: COLUMN evaluations.evaluatee_org_division; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluations.evaluatee_org_division IS '그 기간 본부';


--
-- Name: COLUMN evaluations.evaluatee_org_department; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluations.evaluatee_org_department IS '그 기간 부';


--
-- Name: COLUMN evaluations.evaluatee_org_team; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.evaluations.evaluatee_org_team IS '그 기간 팀';


--
-- Name: evaluator_assignment_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluator_assignment_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text NOT NULL,
    previous_evaluator_id text,
    new_evaluator_id text,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    changed_by text,
    evaluation_id uuid,
    evaluation_period_id uuid,
    change_type text DEFAULT 'change'::text NOT NULL,
    status text DEFAULT 'applied'::text NOT NULL,
    reason text,
    cancelled_at timestamp with time zone,
    cancelled_by text,
    cancel_reason text,
    supersedes_history_id uuid,
    CONSTRAINT chk_evaluator_assignment_history_change_type CHECK ((change_type = ANY (ARRAY['change'::text, 'cancel'::text]))),
    CONSTRAINT chk_evaluator_assignment_history_status CHECK ((status = ANY (ARRAY['applied'::text, 'cancelled'::text])))
);


--
-- Name: evaluator_change_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluator_change_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    evaluatee_id text NOT NULL,
    evaluatee_name text,
    current_evaluator_id text,
    current_evaluator_name text,
    requested_evaluator_id text,
    requested_evaluator_name text,
    evaluation_period_id uuid,
    requested_by text NOT NULL,
    requester_role text NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    review_comment text,
    applied_history_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    target_history_id uuid,
    segment_start_date date,
    segment_end_date date
);


--
-- Name: evaluator_qna_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluator_qna_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    user_name text,
    user_department text,
    user_role text,
    question text NOT NULL,
    answer text,
    is_error boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feedback_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_id text NOT NULL,
    content text NOT NULL,
    evaluator_name text,
    created_at timestamp with time zone DEFAULT now(),
    task_uuid uuid,
    evaluation_id uuid,
    evaluator_id text,
    task_evaluation_entry_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by text,
    cancel_reason text,
    CONSTRAINT chk_feedback_history_status CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])))
);


--
-- Name: final_assessment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.final_assessment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    final_assessment_id text NOT NULL,
    evaluation_id uuid NOT NULL,
    evaluation_year integer,
    contribution_method text,
    contribution_scope text,
    growth_level integer,
    feedback text,
    feedback_date timestamp with time zone,
    evaluator_name text,
    created_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: matching_import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matching_import_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_file_name text NOT NULL,
    source_sheet_name text,
    imported_by text,
    row_count integer DEFAULT 0 NOT NULL,
    applied_count integer DEFAULT 0 NOT NULL,
    warning_count integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'applied'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    evaluation_period_id uuid,
    CONSTRAINT matching_import_batches_status_check CHECK ((status = ANY (ARRAY['applied'::text, 'failed'::text])))
);


--
-- Name: matching_import_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matching_import_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
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
    is_primary boolean DEFAULT false NOT NULL,
    validation_status text DEFAULT 'valid'::text NOT NULL,
    validation_message text,
    raw_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    org_corporation text,
    org_division text,
    org_department text,
    org_team text,
    CONSTRAINT matching_import_rows_validation_status_check CHECK ((validation_status = ANY (ARRAY['valid'::text, 'warning'::text, 'error'::text])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notification_type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    priority text NOT NULL,
    sender_id text NOT NULL,
    sender_name text NOT NULL,
    recipient_id text NOT NULL,
    related_evaluation_id uuid,
    related_task_id text,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    related_final_assessment_id text,
    CONSTRAINT notifications_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
);


--
-- Name: org_structure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_structure (
    dept_code text NOT NULL,
    evaluation_period_id uuid NOT NULL,
    dept_name text,
    org_corporation text,
    org_division text,
    org_department text,
    org_team text,
    t_level integer,
    kind text,
    source_label text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE org_structure; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.org_structure IS '평가기간별 부서코드 → 4단계 조직(법인/본부/부/팀) 참조. 조직구조 엑셀 업로드(기간 지정)로 갱신.';


--
-- Name: COLUMN org_structure.evaluation_period_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.org_structure.evaluation_period_id IS '이 조직 스냅샷이 적용되는 평가기간';


--
-- Name: password_reset_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id text NOT NULL,
    employee_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    reason text,
    resolved_by text,
    resolved_at timestamp with time zone,
    review_comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prompt_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prompt_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    content text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    setting_type text NOT NULL,
    setting_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: task_evaluation_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_evaluation_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    task_uuid uuid NOT NULL,
    task_id text NOT NULL,
    evaluation_id uuid NOT NULL,
    evaluator_id text NOT NULL,
    evaluator_name text NOT NULL,
    contribution_method text,
    contribution_scope text,
    score integer,
    feedback text,
    feedback_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assignment_history_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by text,
    cancel_reason text,
    ai_flagged boolean,
    ai_summary text,
    ai_reviewed_at timestamp with time zone,
    ai_feedback_hash text,
    ai_type text,
    CONSTRAINT chk_task_evaluation_entries_status CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])))
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
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
    feedback_date timestamp with time zone,
    evaluator_name text,
    created_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    evaluation_year integer DEFAULT EXTRACT(year FROM CURRENT_DATE) NOT NULL,
    evaluation_period_id uuid,
    is_ai_task boolean DEFAULT false NOT NULL
);


--
-- Name: admin_audit_logs admin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: ai_generated_content ai_generated_content_kind_scope_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generated_content
    ADD CONSTRAINT ai_generated_content_kind_scope_uniq UNIQUE (kind, scope_id);


--
-- Name: ai_generated_content ai_generated_content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_generated_content
    ADD CONSTRAINT ai_generated_content_pkey PRIMARY KEY (id);


--
-- Name: employee_profile_import_batches employee_profile_import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profile_import_batches
    ADD CONSTRAINT employee_profile_import_batches_pkey PRIMARY KEY (id);


--
-- Name: employee_profile_import_rows employee_profile_import_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profile_import_rows
    ADD CONSTRAINT employee_profile_import_rows_pkey PRIMARY KEY (id);


--
-- Name: employees employees_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_employee_id_key UNIQUE (employee_id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: evaluation_periods evaluation_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_periods
    ADD CONSTRAINT evaluation_periods_pkey PRIMARY KEY (id);


--
-- Name: evaluations evaluations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT evaluations_pkey PRIMARY KEY (id);


--
-- Name: evaluator_assignment_history evaluator_assignment_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluator_assignment_history
    ADD CONSTRAINT evaluator_assignment_history_pkey PRIMARY KEY (id);


--
-- Name: evaluator_change_requests evaluator_change_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluator_change_requests
    ADD CONSTRAINT evaluator_change_requests_pkey PRIMARY KEY (id);


--
-- Name: evaluator_qna_logs evaluator_qna_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluator_qna_logs
    ADD CONSTRAINT evaluator_qna_logs_pkey PRIMARY KEY (id);


--
-- Name: feedback_history feedback_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_history
    ADD CONSTRAINT feedback_history_pkey PRIMARY KEY (id);


--
-- Name: final_assessment final_assessment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.final_assessment
    ADD CONSTRAINT final_assessment_pkey PRIMARY KEY (id);


--
-- Name: matching_import_batches matching_import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matching_import_batches
    ADD CONSTRAINT matching_import_batches_pkey PRIMARY KEY (id);


--
-- Name: matching_import_rows matching_import_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matching_import_rows
    ADD CONSTRAINT matching_import_rows_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: org_structure org_structure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_structure
    ADD CONSTRAINT org_structure_pkey PRIMARY KEY (dept_code, evaluation_period_id);


--
-- Name: password_reset_requests password_reset_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_requests
    ADD CONSTRAINT password_reset_requests_pkey PRIMARY KEY (id);


--
-- Name: prompt_templates prompt_templates_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_templates
    ADD CONSTRAINT prompt_templates_key_key UNIQUE (key);


--
-- Name: prompt_templates prompt_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prompt_templates
    ADD CONSTRAINT prompt_templates_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: settings settings_user_type_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_user_type_unique UNIQUE (user_id, setting_type);


--
-- Name: task_evaluation_entries task_evaluation_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_evaluation_entries
    ADD CONSTRAINT task_evaluation_entries_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: employee_profile_import_rows uq_employee_profile_import_rows_batch_sheet_row; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profile_import_rows
    ADD CONSTRAINT uq_employee_profile_import_rows_batch_sheet_row UNIQUE (batch_id, sheet_name, row_number);


--
-- Name: evaluation_periods uq_evaluation_periods_code; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluation_periods
    ADD CONSTRAINT uq_evaluation_periods_code UNIQUE (code);


--
-- Name: evaluations uq_evaluations_id_year; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT uq_evaluations_id_year UNIQUE (id, evaluation_year);


--
-- Name: final_assessment uq_final_assessment_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.final_assessment
    ADD CONSTRAINT uq_final_assessment_id UNIQUE (final_assessment_id);


--
-- Name: matching_import_rows uq_matching_import_rows_batch_row; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matching_import_rows
    ADD CONSTRAINT uq_matching_import_rows_batch_row UNIQUE (batch_id, row_number);


--
-- Name: task_evaluation_entries uq_task_evaluation_entries_task_evaluator; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_evaluation_entries
    ADD CONSTRAINT uq_task_evaluation_entries_task_evaluator UNIQUE (task_uuid, evaluator_id);


--
-- Name: tasks uq_tasks_task_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT uq_tasks_task_id UNIQUE (task_id);


--
-- Name: idx_admin_audit_logs_action_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_logs_action_type ON public.admin_audit_logs USING btree (action_type);


--
-- Name: idx_admin_audit_logs_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_logs_actor ON public.admin_audit_logs USING btree (actor_id, created_at DESC);


--
-- Name: idx_admin_audit_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_logs_created_at ON public.admin_audit_logs USING btree (created_at DESC);


--
-- Name: idx_admin_audit_logs_target_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_logs_target_employee ON public.admin_audit_logs USING btree (target_employee_id, created_at DESC);


--
-- Name: idx_ecr_evaluatee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ecr_evaluatee ON public.evaluator_change_requests USING btree (evaluatee_id);


--
-- Name: idx_ecr_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ecr_period ON public.evaluator_change_requests USING btree (evaluation_period_id);


--
-- Name: idx_ecr_requested_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ecr_requested_by ON public.evaluator_change_requests USING btree (requested_by);


--
-- Name: idx_ecr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ecr_status ON public.evaluator_change_requests USING btree (status);


--
-- Name: idx_employee_profile_import_batches_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_profile_import_batches_created ON public.employee_profile_import_batches USING btree (created_at DESC);


--
-- Name: idx_employee_profile_import_batches_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_profile_import_batches_period ON public.employee_profile_import_batches USING btree (evaluation_period_id);


--
-- Name: idx_employee_profile_import_rows_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_profile_import_rows_batch ON public.employee_profile_import_rows USING btree (batch_id, sheet_name, row_number);


--
-- Name: idx_employee_profile_import_rows_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_profile_import_rows_employee ON public.employee_profile_import_rows USING btree (employee_id);


--
-- Name: idx_employee_profile_import_rows_evaluator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_profile_import_rows_evaluator ON public.employee_profile_import_rows USING btree (evaluator_id);


--
-- Name: idx_employee_profile_import_rows_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_profile_import_rows_group ON public.employee_profile_import_rows USING btree (evaluation_group_id);


--
-- Name: idx_employees_department_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_department_id ON public.employees USING btree (department_id);


--
-- Name: idx_employees_evaluation_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_evaluation_group ON public.employees USING btree (evaluation_group_id);


--
-- Name: idx_employees_evaluator_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_evaluator_id ON public.employees USING btree (evaluator_id);


--
-- Name: idx_employees_last_matching_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_last_matching_batch ON public.employees USING btree (last_matching_batch_id);


--
-- Name: idx_employees_last_profile_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_last_profile_batch ON public.employees USING btree (last_profile_batch_id);


--
-- Name: idx_employees_org_corporation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_org_corporation ON public.employees USING btree (org_corporation);


--
-- Name: idx_employees_org_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_org_department ON public.employees USING btree (org_department);


--
-- Name: idx_employees_org_division; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_org_division ON public.employees USING btree (org_division);


--
-- Name: idx_employees_org_team; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_org_team ON public.employees USING btree (org_team);


--
-- Name: idx_eql_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eql_created ON public.evaluator_qna_logs USING btree (created_at DESC);


--
-- Name: idx_eql_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eql_user ON public.evaluator_qna_logs USING btree (user_id);


--
-- Name: idx_eval_period_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_period_org ON public.evaluations USING btree (evaluation_period_id, evaluatee_org_corporation, evaluatee_org_division, evaluatee_org_department, evaluatee_org_team);


--
-- Name: idx_evaluations_assignment_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluations_assignment_history ON public.evaluations USING btree (assignment_history_id);


--
-- Name: idx_evaluations_evaluatee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluations_evaluatee_id ON public.evaluations USING btree (evaluatee_id);


--
-- Name: idx_evaluations_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluations_period ON public.evaluations USING btree (evaluation_period_id);


--
-- Name: idx_evaluations_record_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluations_record_status ON public.evaluations USING btree (record_status);


--
-- Name: idx_evaluator_assignment_history_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluator_assignment_history_employee ON public.evaluator_assignment_history USING btree (employee_id);


--
-- Name: idx_evaluator_assignment_history_employee_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluator_assignment_history_employee_status ON public.evaluator_assignment_history USING btree (employee_id, status, changed_at DESC);


--
-- Name: idx_evaluator_assignment_history_evaluation_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluator_assignment_history_evaluation_status ON public.evaluator_assignment_history USING btree (evaluation_id, status);


--
-- Name: idx_evaluator_assignment_history_new; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluator_assignment_history_new ON public.evaluator_assignment_history USING btree (new_evaluator_id);


--
-- Name: idx_evaluator_assignment_history_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluator_assignment_history_period ON public.evaluator_assignment_history USING btree (evaluation_period_id);


--
-- Name: idx_evaluator_assignment_history_previous; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluator_assignment_history_previous ON public.evaluator_assignment_history USING btree (previous_evaluator_id);


--
-- Name: idx_evaluator_assignment_history_supersedes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evaluator_assignment_history_supersedes ON public.evaluator_assignment_history USING btree (supersedes_history_id);


--
-- Name: idx_feedback_history_evaluation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_history_evaluation ON public.feedback_history USING btree (evaluation_id);


--
-- Name: idx_feedback_history_evaluator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_history_evaluator ON public.feedback_history USING btree (evaluator_id);


--
-- Name: idx_feedback_history_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_history_status ON public.feedback_history USING btree (status);


--
-- Name: idx_feedback_history_task_evaluation_entry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_history_task_evaluation_entry ON public.feedback_history USING btree (task_evaluation_entry_id);


--
-- Name: idx_feedback_history_task_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_history_task_uuid ON public.feedback_history USING btree (task_uuid);


--
-- Name: idx_matching_import_batches_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matching_import_batches_created ON public.matching_import_batches USING btree (created_at DESC);


--
-- Name: idx_matching_import_batches_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matching_import_batches_period ON public.matching_import_batches USING btree (evaluation_period_id);


--
-- Name: idx_matching_import_rows_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matching_import_rows_batch ON public.matching_import_rows USING btree (batch_id, row_number);


--
-- Name: idx_matching_import_rows_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matching_import_rows_employee ON public.matching_import_rows USING btree (employee_id);


--
-- Name: idx_matching_import_rows_evaluator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matching_import_rows_evaluator ON public.matching_import_rows USING btree (evaluator_id);


--
-- Name: idx_matching_import_rows_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matching_import_rows_primary ON public.matching_import_rows USING btree (batch_id, is_primary);


--
-- Name: idx_prr_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prr_employee ON public.password_reset_requests USING btree (employee_id);


--
-- Name: idx_prr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prr_status ON public.password_reset_requests USING btree (status);


--
-- Name: idx_task_evaluation_entries_assignment_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_evaluation_entries_assignment_history ON public.task_evaluation_entries USING btree (assignment_history_id);


--
-- Name: idx_task_evaluation_entries_evaluation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_evaluation_entries_evaluation ON public.task_evaluation_entries USING btree (evaluation_id);


--
-- Name: idx_task_evaluation_entries_evaluator; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_evaluation_entries_evaluator ON public.task_evaluation_entries USING btree (evaluator_id);


--
-- Name: idx_task_evaluation_entries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_evaluation_entries_status ON public.task_evaluation_entries USING btree (status);


--
-- Name: idx_task_evaluation_entries_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_evaluation_entries_task ON public.task_evaluation_entries USING btree (task_uuid);


--
-- Name: idx_tasks_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_period ON public.tasks USING btree (evaluation_period_id);


--
-- Name: uq_evaluation_periods_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_evaluation_periods_code_idx ON public.evaluation_periods USING btree (code);


--
-- Name: uq_evaluation_periods_single_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_evaluation_periods_single_default ON public.evaluation_periods USING btree (is_default) WHERE is_default;


--
-- Name: uq_prr_pending_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_prr_pending_employee ON public.password_reset_requests USING btree (employee_id) WHERE (status = 'pending'::text);


--
-- Name: prompt_templates set_timestamp_on_prompt_templates; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_timestamp_on_prompt_templates BEFORE UPDATE ON public.prompt_templates FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();


--
-- Name: employees trg_create_default_evaluation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_create_default_evaluation AFTER INSERT ON public.employees FOR EACH ROW EXECUTE FUNCTION public.create_default_evaluation();


--
-- Name: final_assessment trg_set_final_assessment_growth_level; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_final_assessment_growth_level BEFORE INSERT OR UPDATE ON public.final_assessment FOR EACH ROW EXECUTE FUNCTION public.set_final_assessment_growth_level();


--
-- Name: admin_audit_logs fk_admin_audit_logs_actor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT fk_admin_audit_logs_actor FOREIGN KEY (actor_id) REFERENCES public.employees(employee_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: admin_audit_logs fk_admin_audit_logs_target_employee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT fk_admin_audit_logs_target_employee FOREIGN KEY (target_employee_id) REFERENCES public.employees(employee_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employee_profile_import_batches fk_employee_profile_import_batches_imported_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profile_import_batches
    ADD CONSTRAINT fk_employee_profile_import_batches_imported_by FOREIGN KEY (imported_by) REFERENCES public.employees(employee_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employee_profile_import_rows fk_employee_profile_import_rows_batch; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_profile_import_rows
    ADD CONSTRAINT fk_employee_profile_import_rows_batch FOREIGN KEY (batch_id) REFERENCES public.employee_profile_import_batches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: employees fk_employees_evaluator; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT fk_employees_evaluator FOREIGN KEY (evaluator_id) REFERENCES public.employees(employee_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employees fk_employees_last_matching_batch; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT fk_employees_last_matching_batch FOREIGN KEY (last_matching_batch_id) REFERENCES public.matching_import_batches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: employees fk_employees_last_profile_batch; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT fk_employees_last_profile_batch FOREIGN KEY (last_profile_batch_id) REFERENCES public.employee_profile_import_batches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: evaluations fk_evaluations_assignment_history; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT fk_evaluations_assignment_history FOREIGN KEY (assignment_history_id) REFERENCES public.evaluator_assignment_history(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: evaluations fk_evaluations_evaluatee; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT fk_evaluations_evaluatee FOREIGN KEY (evaluatee_id) REFERENCES public.employees(employee_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: evaluations fk_evaluations_period; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluations
    ADD CONSTRAINT fk_evaluations_period FOREIGN KEY (evaluation_period_id) REFERENCES public.evaluation_periods(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: evaluator_assignment_history fk_evaluator_assignment_history_evaluation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluator_assignment_history
    ADD CONSTRAINT fk_evaluator_assignment_history_evaluation FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: evaluator_assignment_history fk_evaluator_assignment_history_period; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluator_assignment_history
    ADD CONSTRAINT fk_evaluator_assignment_history_period FOREIGN KEY (evaluation_period_id) REFERENCES public.evaluation_periods(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: evaluator_assignment_history fk_evaluator_assignment_history_supersedes; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluator_assignment_history
    ADD CONSTRAINT fk_evaluator_assignment_history_supersedes FOREIGN KEY (supersedes_history_id) REFERENCES public.evaluator_assignment_history(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: feedback_history fk_feedback_history_evaluation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_history
    ADD CONSTRAINT fk_feedback_history_evaluation FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: feedback_history fk_feedback_history_evaluator; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_history
    ADD CONSTRAINT fk_feedback_history_evaluator FOREIGN KEY (evaluator_id) REFERENCES public.employees(employee_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: feedback_history fk_feedback_history_task_evaluation_entry; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_history
    ADD CONSTRAINT fk_feedback_history_task_evaluation_entry FOREIGN KEY (task_evaluation_entry_id) REFERENCES public.task_evaluation_entries(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: feedback_history fk_feedback_history_task_uuid; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_history
    ADD CONSTRAINT fk_feedback_history_task_uuid FOREIGN KEY (task_uuid) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: feedback_history fk_feedback_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_history
    ADD CONSTRAINT fk_feedback_task FOREIGN KEY (task_id) REFERENCES public.tasks(task_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: final_assessment fk_final_assessment_evaluations; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.final_assessment
    ADD CONSTRAINT fk_final_assessment_evaluations FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id);


--
-- Name: matching_import_batches fk_matching_import_batches_imported_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matching_import_batches
    ADD CONSTRAINT fk_matching_import_batches_imported_by FOREIGN KEY (imported_by) REFERENCES public.employees(employee_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: matching_import_rows fk_matching_import_rows_batch; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matching_import_rows
    ADD CONSTRAINT fk_matching_import_rows_batch FOREIGN KEY (batch_id) REFERENCES public.matching_import_batches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications fk_notifications_evaluation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_evaluation FOREIGN KEY (related_evaluation_id) REFERENCES public.evaluations(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: notifications fk_notifications_final_assessment; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_final_assessment FOREIGN KEY (related_final_assessment_id) REFERENCES public.final_assessment(final_assessment_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: notifications fk_notifications_recipient; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES public.employees(employee_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: notifications fk_notifications_sender; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_sender FOREIGN KEY (sender_id) REFERENCES public.employees(employee_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: notifications fk_notifications_task; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT fk_notifications_task FOREIGN KEY (related_task_id) REFERENCES public.tasks(task_id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: task_evaluation_entries fk_task_evaluation_entries_assignment_history; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_evaluation_entries
    ADD CONSTRAINT fk_task_evaluation_entries_assignment_history FOREIGN KEY (assignment_history_id) REFERENCES public.evaluator_assignment_history(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: task_evaluation_entries fk_task_evaluation_entries_evaluation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_evaluation_entries
    ADD CONSTRAINT fk_task_evaluation_entries_evaluation FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: task_evaluation_entries fk_task_evaluation_entries_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_evaluation_entries
    ADD CONSTRAINT fk_task_evaluation_entries_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(task_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: task_evaluation_entries fk_task_evaluation_entries_task_uuid; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_evaluation_entries
    ADD CONSTRAINT fk_task_evaluation_entries_task_uuid FOREIGN KEY (task_uuid) REFERENCES public.tasks(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tasks fk_tasks_evaluation; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_evaluation FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: tasks fk_tasks_period; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_period FOREIGN KEY (evaluation_period_id) REFERENCES public.evaluation_periods(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: org_structure org_structure_evaluation_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_structure
    ADD CONSTRAINT org_structure_evaluation_period_id_fkey FOREIGN KEY (evaluation_period_id) REFERENCES public.evaluation_periods(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 8OLwjwGTJwGgEdPOpeTb4W7NabIXLPHtlQa5QNAbnDlCveiHlcfNrRcefjdNABl


--
-- 기본 관리자 계정 시드 (데이터 없음 상태 부트스트랩용)
-- password_hash 를 비워두면 로그인 로직상 초기 비밀번호 = 사번('admin').
-- 즉 admin / admin 으로 첫 로그인 → 비밀번호 변경 강제. 그 뒤 사용자 데이터를 업로드한다.
--
SET search_path TO public;
INSERT INTO public.employees (employee_id, name, position, department, available_roles)
VALUES ('admin', 'Admin', '-', '-', '{hr}')
ON CONFLICT (employee_id) DO NOTHING;


--
-- [스냅샷 이후 추가분] 조직 KPI · UI 임시저장 테이블
-- db_mig/add_org_kpis*.sql · add_ui_drafts.sql 로 추가된 테이블(pg_dump 스냅샷엔 미포함).
-- 없으면 KPI 화면(/api/org-kpis/tree)·자동저장(/api/drafts)이 런타임 500.
-- CREATE TABLE IF NOT EXISTS 라 재적용 안전(서버 부팅 시 ensureRuntimeSchema 도 동일 보강).
--
SET search_path TO public;

CREATE TABLE IF NOT EXISTS org_kpis (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_period_id  uuid NOT NULL REFERENCES evaluation_periods(id) ON DELETE CASCADE,
  parent_kpi_id         uuid REFERENCES org_kpis(id) ON DELETE CASCADE,
  org_level             text NOT NULL,
  org_key               text NOT NULL,
  name                  text NOT NULL,
  unit                  text NOT NULL,
  target_value          numeric NOT NULL,
  direction             text NOT NULL DEFAULT 'higher',
  description           text,
  owner_id              text,
  status                text NOT NULL DEFAULT 'active',
  created_by            text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  achieved_value        numeric,
  org_path_corporation  text,
  org_path_division     text,
  org_path_department   text,
  CONSTRAINT chk_org_kpis_level     CHECK (org_level IN ('corporation','division','department','team')),
  CONSTRAINT chk_org_kpis_direction CHECK (direction IN ('higher','lower')),
  CONSTRAINT chk_org_kpis_status    CHECK (status IN ('active','archived')),
  CONSTRAINT chk_org_kpis_target    CHECK (target_value > 0)
);
CREATE INDEX IF NOT EXISTS idx_org_kpis_period_org ON org_kpis(evaluation_period_id, org_level, org_key);
CREATE INDEX IF NOT EXISTS idx_org_kpis_parent ON org_kpis(parent_kpi_id);

CREATE TABLE IF NOT EXISTS task_kpi_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id            uuid NOT NULL REFERENCES org_kpis(id) ON DELETE CASCADE,
  task_uuid         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_id           text NOT NULL,
  evaluation_id     uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  allocated_target  numeric NOT NULL DEFAULT 0,
  achieved_value    numeric,
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

CREATE TABLE IF NOT EXISTS ui_drafts (
  owner_id   text        NOT NULL,
  draft_key  text        NOT NULL,
  payload    jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, draft_key)
);
