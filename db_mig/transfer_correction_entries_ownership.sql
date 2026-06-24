BEGIN;

-- 정정으로 cancelled 된 history (cancel_reason='Superseded by correction') 의 평가자가
-- 그 evaluation 에 매긴 task_evaluation_entries 와 feedback_history 의 evaluator_id 를
-- supersede 체인을 따라가서 최종 평가자로 이전한다.
-- 정정의 정정처럼 다단계 체인도 지원하기 위해 sup.status 는 조건에 두지 않는다.
-- (한 단계씩 옮긴 뒤 다시 검사 — loop_changed 가 0 일 때까지)
DO $$
DECLARE
  loop_changed integer := 1;
BEGIN
  WHILE loop_changed > 0 LOOP
    WITH updated AS (
      UPDATE public.task_evaluation_entries tee
      SET evaluator_id = sup.new_evaluator_id,
          evaluator_name = COALESCE(
            (SELECT name FROM public.employees WHERE employee_id = sup.new_evaluator_id),
            sup.new_evaluator_id
          ),
          updated_at = NOW()
      FROM public.evaluator_assignment_history orig
      INNER JOIN public.evaluator_assignment_history sup
        ON sup.supersedes_history_id = orig.id
        AND sup.change_type = 'change'
      WHERE orig.status = 'cancelled'
        AND orig.cancel_reason = 'Superseded by correction'
        AND tee.evaluation_id = orig.evaluation_id
        AND tee.evaluator_id IS NOT DISTINCT FROM orig.new_evaluator_id
        AND tee.evaluator_id IS DISTINCT FROM sup.new_evaluator_id
        AND COALESCE(tee.status, 'active') = 'active'
      RETURNING tee.id
    )
    SELECT COUNT(*) INTO loop_changed FROM updated;
  END LOOP;
END $$;

-- feedback_history 도 같은 원칙으로 체인 따라가며 이전.
DO $$
DECLARE
  loop_changed integer := 1;
BEGIN
  WHILE loop_changed > 0 LOOP
    WITH updated AS (
      UPDATE public.feedback_history fh
      SET evaluator_id = sup.new_evaluator_id,
          evaluator_name = COALESCE(
            (SELECT name FROM public.employees WHERE employee_id = sup.new_evaluator_id),
            sup.new_evaluator_id
          )
      FROM public.evaluator_assignment_history orig
      INNER JOIN public.evaluator_assignment_history sup
        ON sup.supersedes_history_id = orig.id
        AND sup.change_type = 'change'
      WHERE orig.status = 'cancelled'
        AND orig.cancel_reason = 'Superseded by correction'
        AND fh.evaluation_id = orig.evaluation_id
        AND fh.evaluator_id IS NOT DISTINCT FROM orig.new_evaluator_id
        AND fh.evaluator_id IS DISTINCT FROM sup.new_evaluator_id
        AND COALESCE(fh.status, 'active') = 'active'
      RETURNING fh.id
    )
    SELECT COUNT(*) INTO loop_changed FROM updated;
  END LOOP;
END $$;

COMMIT;
