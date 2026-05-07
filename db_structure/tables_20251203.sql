-- public.employees definition

-- Drop table

-- DROP TABLE public.employees;

CREATE TABLE public.employees (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	employee_id text NOT NULL,
	"name" text NOT NULL,
	"position" text NOT NULL,
	department text NOT NULL,
	growth_level int4 NULL,
	evaluator_id text NULL,
	available_roles _text DEFAULT '{evaluatee}'::text[] NOT NULL,
	created_at timestamptz DEFAULT now() NULL,
	updated_at timestamptz DEFAULT now() NULL,
	CONSTRAINT employees_employee_id_key UNIQUE (employee_id),
	CONSTRAINT employees_pkey PRIMARY KEY (id),
	CONSTRAINT fk_employees_evaluator FOREIGN KEY (evaluator_id) REFERENCES public.employees(employee_id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Table Triggers

create trigger trg_create_default_evaluation after
insert
    on
    public.employees for each row execute function create_default_evaluation();

-- public.evaluations definition

-- Drop table

-- DROP TABLE public.evaluations;

CREATE TABLE public.evaluations (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	evaluatee_id text NOT NULL,
	evaluatee_name text NOT NULL,
	evaluatee_position text NOT NULL,
	evaluatee_department text NOT NULL,
	growth_level int4 NOT NULL,
	evaluation_status text NOT NULL,
	last_modified timestamptz DEFAULT now() NULL,
	created_at timestamptz DEFAULT now() NULL,
	updated_at timestamptz DEFAULT now() NULL,
	evaluation_year int4 DEFAULT EXTRACT(year FROM CURRENT_DATE) NOT NULL,
	CONSTRAINT evaluations_evaluation_status_check CHECK ((evaluation_status = ANY (ARRAY['in-progress'::text, 'completed'::text]))),
	CONSTRAINT evaluations_pkey PRIMARY KEY (id),
	CONSTRAINT uq_evaluations_id_year UNIQUE (id, evaluation_year)
);


-- public.evaluations foreign keys

ALTER TABLE public.evaluations
  ADD CONSTRAINT fk_evaluations_evaluatee FOREIGN KEY (evaluatee_id) REFERENCES public.employees(employee_id) ON DELETE RESTRICT ON UPDATE CASCADE;


-- public.feedback_history definition

-- Drop table

-- DROP TABLE public.feedback_history;

CREATE TABLE public.feedback_history (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	task_id text NOT NULL,
	content text NOT NULL,
	evaluator_name text NULL,
	created_at timestamptz DEFAULT now() NULL,
	CONSTRAINT feedback_history_pkey PRIMARY KEY (id)
);


-- public.feedback_history foreign keys

ALTER TABLE public.feedback_history 
  ADD CONSTRAINT fk_feedback_task FOREIGN KEY (task_id) REFERENCES public.tasks(task_id) ON DELETE SET NULL ON UPDATE CASCADE;


-- public.final_assessment definition

-- Drop table

-- DROP TABLE public.final_assessment;

CREATE TABLE public.final_assessment (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	final_assessment_id text NOT NULL,
	evaluation_id uuid NOT NULL,
	evaluation_year int4 NULL,
	contribution_method text NULL,
	contribution_scope text NULL,
	growth_level int4 NULL,
	feedback text NULL,
	feedback_date timestamptz NULL,
	evaluator_name text NULL,
	created_at timestamptz DEFAULT now() NULL,
	deleted_at timestamptz NULL,
	CONSTRAINT final_assessment_pkey PRIMARY KEY (id),
	CONSTRAINT uq_final_assessment_id UNIQUE (final_assessment_id)
);


-- public.final_assessment foreign keys

ALTER TABLE public.final_assessment
  ADD CONSTRAINT fk_final_assessment_evaluations FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id);


-- public.notifications definition

-- Drop table

-- DROP TABLE public.notifications;

CREATE TABLE public.notifications (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	notification_type text NOT NULL,
	title text NOT NULL,
	message text NOT NULL,
	priority text NOT NULL,
	sender_id text NOT NULL,
	sender_name text NOT NULL,
	recipient_id text NOT NULL,
	related_evaluation_id uuid NULL,
	related_task_id text NULL,
	is_read bool DEFAULT false NULL,
	created_at timestamptz DEFAULT now() NULL,
	related_final_assessment_id text NULL,
	CONSTRAINT notifications_pkey PRIMARY KEY (id),
	CONSTRAINT notifications_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
);


-- public.notifications foreign keys

ALTER TABLE public.notifications ADD CONSTRAINT fk_notifications_evaluation FOREIGN KEY (related_evaluation_id) REFERENCES public.evaluations(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT fk_notifications_final_assessment FOREIGN KEY (related_final_assessment_id) REFERENCES public.final_assessment(final_assessment_id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES public.employees(employee_id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT fk_notifications_sender FOREIGN KEY (sender_id) REFERENCES public.employees(employee_id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT fk_notifications_task FOREIGN KEY (related_task_id) REFERENCES public.tasks(task_id) ON DELETE SET NULL ON UPDATE CASCADE;


-- public.tasks definition

-- Drop table

-- DROP TABLE public.tasks;

CREATE TABLE public.tasks (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	task_id text NOT NULL,
	evaluation_id uuid NOT NULL,
	title text NOT NULL,
	weight int4 DEFAULT 0 NULL,
	description text NULL,
	start_date date NULL,
	end_date date NULL,
	contribution_method text NULL,
	contribution_scope text NULL,
	score int4 NULL,
	feedback text NULL,
	feedback_date timestamptz NULL,
	evaluator_name text NULL,
	created_at timestamptz DEFAULT now() NULL,
	deleted_at timestamptz NULL,
	evaluation_year int4 DEFAULT EXTRACT(year FROM CURRENT_DATE) NOT NULL,
	CONSTRAINT tasks_pkey PRIMARY KEY (id),
	CONSTRAINT uq_tasks_task_id UNIQUE (task_id)
);


-- public.tasks foreign keys

ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_evaluation FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id) ON DELETE RESTRICT ON UPDATE CASCADE;