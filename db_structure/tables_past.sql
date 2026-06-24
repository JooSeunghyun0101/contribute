CREATE TABLE public.api_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL,
  key_value text NOT NULL,
  service_type character varying NOT NULL DEFAULT 'gemini'::character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by character varying NOT NULL DEFAULT 'H1000005'::character varying,
  is_active boolean DEFAULT true,
  description text,
  CONSTRAINT api_keys_pkey PRIMARY KEY (id)
);
CREATE TABLE public.employees (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id text NOT NULL UNIQUE,
  name text NOT NULL,
  position text NOT NULL,
  department text NOT NULL,
  growth_level integer,
  evaluator_id text,
  available_roles text[] NOT NULL DEFAULT '{evaluatee}'::text[],
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT employees_pkey PRIMARY KEY (id)
);
CREATE TABLE public.evaluations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  evaluatee_id text NOT NULL,
  evaluatee_name text NOT NULL,
  evaluatee_position text NOT NULL,
  evaluatee_department text NOT NULL,
  growth_level integer NOT NULL,
  evaluation_status text NOT NULL CHECK (evaluation_status = ANY (ARRAY['in-progress'::text, 'completed'::text])),
  last_modified timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT evaluations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.feedback_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id text NOT NULL,
  content text NOT NULL,
  evaluator_name text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT feedback_history_pkey PRIMARY KEY (id)
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
  related_evaluation_id text,
  related_task_id text,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);
CREATE TABLE public.settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  setting_type text NOT NULL,
  setting_data jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT settings_pkey PRIMARY KEY (id)
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
  feedback_date timestamp with time zone,
  evaluator_name text,
  created_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone,
  CONSTRAINT tasks_pkey PRIMARY KEY (id)
);