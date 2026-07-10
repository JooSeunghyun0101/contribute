-- Migration to fix related_evaluation_id type and add foreign key
BEGIN;
-- Clean invalid values (empty strings or non‑UUID text)
UPDATE public.notifications
SET related_evaluation_id = NULL
WHERE trim(related_evaluation_id) = ''
   OR NOT trim(related_evaluation_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Convert column to UUID if it is still of type text
DO $$
BEGIN
   IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notifications'
        AND column_name = 'related_evaluation_id'
        AND data_type = 'text'
   ) THEN
      ALTER TABLE public.notifications
        ALTER COLUMN related_evaluation_id TYPE uuid USING (related_evaluation_id::uuid);
   END IF;
END
$$;

-- Remove any existing foreign‑key constraint
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS fk_notifications_evaluation;

-- Add the correct foreign‑key constraint (UUID ↔ UUID)
ALTER TABLE public.notifications
  ADD CONSTRAINT fk_notifications_evaluation
    FOREIGN KEY (related_evaluation_id) REFERENCES public.evaluations(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL;
COMMIT;