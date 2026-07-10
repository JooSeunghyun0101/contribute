BEGIN;

-- 평가자 AI 도움말(문의) 이력 보관.
-- 평가자가 /team/ai 화면에서 AI 에게 남긴 질문과 받은 답변을 1턴씩 기록한다.
-- 평가자 본인에게는 노출하지 않고, HR 이 사용자별 문의 이력을 감사·참고용으로 조회한다.
CREATE TABLE IF NOT EXISTS public.evaluator_qna_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,            -- 문의를 남긴 사용자(평가자) 사번
  user_name text,                   -- 문의 당시 이름 스냅샷
  user_department text,             -- 문의 당시 부서 스냅샷
  user_role text,                   -- 문의 당시 역할(예: 'evaluator')
  question text NOT NULL,           -- 사용자가 남긴 질문
  answer text,                      -- AI 답변(실패 시 null)
  is_error boolean NOT NULL DEFAULT false,  -- AI 응답 실패 여부
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eql_user ON public.evaluator_qna_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_eql_created ON public.evaluator_qna_logs(created_at DESC);

COMMIT;
