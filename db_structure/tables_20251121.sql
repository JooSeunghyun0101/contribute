-- -- Drop existing tables
-- DROP TABLE IF EXISTS public.notifications CASCADE;
-- DROP TABLE IF EXISTS public.feedback_history CASCADE;
-- DROP TABLE IF EXISTS public.tasks CASCADE;
-- DROP TABLE IF EXISTS public.evaluations CASCADE;
-- DROP TABLE IF EXISTS public.employees CASCADE;

-- Create tables
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
-- Ensure task_id is unique to allow foreign key references
ALTER TABLE public.tasks
  ADD CONSTRAINT uq_tasks_task_id UNIQUE (task_id);

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
  related_evaluation_id uuid,
  related_task_id text,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);

-- Add foreign key constraints
ALTER TABLE public.employees
  ADD CONSTRAINT fk_employees_evaluator
  FOREIGN KEY (evaluator_id) REFERENCES public.employees(employee_id)
  ON UPDATE CASCADE ON DELETE SET NULL;
-- Trigger function to create a default evaluation when a new employee is inserted
CREATE OR REPLACE FUNCTION public.create_default_evaluation()
RETURNS trigger AS $$
BEGIN
   INSERT INTO public.evaluations (
       evaluatee_id,
       evaluatee_name,
       evaluatee_position,
       evaluatee_department,
       growth_level,
       evaluation_status,
       created_at,
       updated_at
   ) VALUES (
       NEW.employee_id,
       NEW.name,
       NEW.position,
       NEW.department,
       COALESCE(NEW.growth_level, 0),
       'in-progress',
       now(),
       now()
   );
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger that fires after an employee row is inserted
CREATE TRIGGER trg_create_default_evaluation
AFTER INSERT ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.create_default_evaluation();

ALTER TABLE public.evaluations
  ADD CONSTRAINT fk_evaluations_evaluatee
  FOREIGN KEY (evaluatee_id) REFERENCES public.employees(employee_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_evaluation
  FOREIGN KEY (evaluation_id) REFERENCES public.evaluations(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE public.feedback_history
  ADD CONSTRAINT fk_feedback_task
  FOREIGN KEY (task_id) REFERENCES public.tasks(task_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD CONSTRAINT fk_notifications_sender
    FOREIGN KEY (sender_id) REFERENCES public.employees(employee_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_notifications_recipient
    FOREIGN KEY (recipient_id) REFERENCES public.employees(employee_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_notifications_evaluation
    FOREIGN KEY (related_evaluation_id) REFERENCES public.evaluations(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_notifications_task
    FOREIGN KEY (related_task_id) REFERENCES public.tasks(task_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

COMMIT;
