BEGIN;

WITH latest_direct_edit AS (
  SELECT DISTINCT ON (target_employee_id)
    target_employee_id,
    new_value->>'evaluator_id' AS current_evaluator_id,
    actor_id,
    reason,
    created_at
  FROM public.admin_audit_logs
  WHERE action_type = 'evaluator_edit'
    AND new_value->>'evaluator_id' IS NOT NULL
  ORDER BY target_employee_id, created_at DESC
),
anchor AS (
  SELECT DISTINCT ON (h.employee_id)
    h.employee_id,
    h.id,
    h.changed_at
  FROM public.evaluator_assignment_history h
  INNER JOIN latest_direct_edit edit ON edit.target_employee_id = h.employee_id
  WHERE h.status = 'applied'
    AND h.change_type <> 'cancel'
    AND h.new_evaluator_id IS NOT DISTINCT FROM edit.current_evaluator_id
  ORDER BY h.employee_id, h.changed_at DESC, h.id DESC
),
latest_mismatch AS (
  SELECT DISTINCT ON (h.employee_id)
    h.employee_id,
    h.id
  FROM public.evaluator_assignment_history h
  INNER JOIN latest_direct_edit edit ON edit.target_employee_id = h.employee_id
  WHERE h.status = 'applied'
    AND h.change_type <> 'cancel'
    AND h.new_evaluator_id IS DISTINCT FROM edit.current_evaluator_id
  ORDER BY h.employee_id, h.changed_at DESC, h.id DESC
),
to_cancel AS (
  SELECT h.id, edit.actor_id, edit.reason
  FROM public.evaluator_assignment_history h
  INNER JOIN latest_direct_edit edit ON edit.target_employee_id = h.employee_id
  LEFT JOIN anchor ON anchor.employee_id = h.employee_id
  WHERE h.status = 'applied'
    AND h.change_type <> 'cancel'
    AND h.new_evaluator_id IS DISTINCT FROM edit.current_evaluator_id
    AND (
      (
        anchor.id IS NOT NULL
        AND (h.changed_at, h.id::text) > (anchor.changed_at, anchor.id::text)
      )
      OR (
        anchor.id IS NULL
        AND h.id IN (SELECT id FROM latest_mismatch)
      )
    )
)
UPDATE public.evaluator_assignment_history h
SET
  status = 'cancelled',
  cancelled_at = now(),
  cancelled_by = to_cancel.actor_id,
  cancel_reason = COALESCE(to_cancel.reason, 'HR evaluator edit')
FROM to_cancel
WHERE h.id = to_cancel.id;

COMMIT;
