BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
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

DO $$
BEGIN
  ALTER TABLE public.admin_audit_logs
    ADD CONSTRAINT fk_admin_audit_logs_actor
    FOREIGN KEY (actor_id) REFERENCES public.employees(employee_id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.admin_audit_logs
    ADD CONSTRAINT fk_admin_audit_logs_target_employee
    FOREIGN KEY (target_employee_id) REFERENCES public.employees(employee_id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_type
  ON public.admin_audit_logs (action_type);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_employee
  ON public.admin_audit_logs (target_employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor
  ON public.admin_audit_logs (actor_id, created_at DESC);

COMMIT;
