BEGIN;

WITH direct_edits AS (
  SELECT DISTINCT ON (target_employee_id, previous_value->>'evaluator_id')
    target_employee_id,
    previous_value->>'evaluator_id' AS previous_evaluator_id,
    new_value->>'evaluator_id' AS new_evaluator_id,
    created_at
  FROM public.admin_audit_logs
  WHERE action_type = 'evaluator_edit'
    AND previous_value->>'evaluator_id' IS NOT NULL
    AND new_value->>'evaluator_id' IS NOT NULL
  ORDER BY target_employee_id, previous_value->>'evaluator_id', created_at DESC
),
restorable_entries AS (
  SELECT
    tee.id,
    tee.task_uuid,
    direct_edits.new_evaluator_id,
    new_evaluator.name AS new_evaluator_name
  FROM public.task_evaluation_entries tee
  INNER JOIN public.evaluations ev ON ev.id = tee.evaluation_id
  INNER JOIN direct_edits
    ON direct_edits.target_employee_id = ev.evaluatee_id
   AND direct_edits.previous_evaluator_id = tee.evaluator_id
  INNER JOIN public.employees new_evaluator
    ON new_evaluator.employee_id = direct_edits.new_evaluator_id
  WHERE tee.status = 'cancelled'
    AND tee.cancel_reason = 'HR evaluator edit'
    AND NOT EXISTS (
      SELECT 1
      FROM public.task_evaluation_entries conflict
      WHERE conflict.task_uuid = tee.task_uuid
        AND conflict.evaluator_id = direct_edits.new_evaluator_id
        AND conflict.id <> tee.id
    )
),
updated_entries AS (
  UPDATE public.task_evaluation_entries tee
  SET
    evaluator_id = restorable_entries.new_evaluator_id,
    evaluator_name = restorable_entries.new_evaluator_name,
    assignment_history_id = NULL,
    status = 'active',
    cancelled_at = NULL,
    cancelled_by = NULL,
    cancel_reason = NULL,
    updated_at = now()
  FROM restorable_entries
  WHERE tee.id = restorable_entries.id
  RETURNING tee.id, tee.task_uuid, tee.evaluator_id, tee.evaluator_name
),
updated_feedback AS (
  UPDATE public.feedback_history fh
  SET
    evaluator_id = updated_entries.evaluator_id,
    evaluator_name = updated_entries.evaluator_name,
    task_evaluation_entry_id = updated_entries.id,
    status = 'active',
    cancelled_at = NULL,
    cancelled_by = NULL,
    cancel_reason = NULL
  FROM updated_entries
  WHERE fh.task_uuid = updated_entries.task_uuid
    AND (
      fh.task_evaluation_entry_id = updated_entries.id
      OR fh.cancel_reason = 'HR evaluator edit'
    )
  RETURNING fh.id
),
affected AS (
  SELECT DISTINCT task_uuid
  FROM updated_entries
),
entry_counts AS (
  SELECT
    tee.task_uuid,
    COUNT(*) AS total_count
  FROM public.task_evaluation_entries tee
  INNER JOIN affected a ON a.task_uuid = tee.task_uuid
  GROUP BY tee.task_uuid
),
latest AS (
  SELECT DISTINCT ON (tee.task_uuid)
    tee.task_uuid,
    tee.contribution_method,
    tee.contribution_scope,
    tee.score,
    tee.feedback,
    tee.feedback_date,
    tee.evaluator_name
  FROM public.task_evaluation_entries tee
  INNER JOIN affected a ON a.task_uuid = tee.task_uuid
  WHERE COALESCE(tee.status, 'active') = 'active'
  ORDER BY tee.task_uuid, tee.updated_at DESC, tee.created_at DESC
)
UPDATE public.tasks t
SET
  contribution_method = CASE WHEN entry_counts.total_count > 0 THEN latest.contribution_method ELSE t.contribution_method END,
  contribution_scope = CASE WHEN entry_counts.total_count > 0 THEN latest.contribution_scope ELSE t.contribution_scope END,
  score = CASE WHEN entry_counts.total_count > 0 THEN latest.score ELSE t.score END,
  feedback = CASE WHEN entry_counts.total_count > 0 THEN latest.feedback ELSE t.feedback END,
  feedback_date = CASE WHEN entry_counts.total_count > 0 THEN latest.feedback_date ELSE t.feedback_date END,
  evaluator_name = CASE WHEN entry_counts.total_count > 0 THEN latest.evaluator_name ELSE t.evaluator_name END
FROM affected a
LEFT JOIN entry_counts ON entry_counts.task_uuid = a.task_uuid
LEFT JOIN latest ON latest.task_uuid = a.task_uuid
WHERE t.id = a.task_uuid;

COMMIT;
