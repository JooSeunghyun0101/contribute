export interface PromptTemplate {
  key: string;
  description: string;
  content: string;
  updated_at?: string;
}

const DEFAULT_PROMPTS: PromptTemplate[] = [
  {
    key: 'evaluation_guide',
    description: '성과평가 기준과 점수 매트릭스 공통 가이드',
    content: `수시 성과관리체계 기준을 바탕으로 평가합니다.
- 점수는 성장레벨별 요구수준 대비 달성 수준을 뜻합니다.
- 기여방식은 총괄, 리딩, 실무, 지원으로 판단합니다.
- 기여범위는 의존적, 독립적, 상호적, 전략적으로 판단합니다.
- 피드백은 구체적 행동, 성과, 영향, 다음 개선 방향을 포함해야 합니다.`,
  },
  {
    key: 'feedback_recommendation',
    description: '과업 정보와 점수 기반 피드백 초안 생성',
    content: `당신은 성과평가 피드백 작성 도우미입니다.
입력된 과업, 기여방식, 기여범위, 점수를 기준으로 500자 이내의 구체적인 피드백을 작성하세요.
구체적 행동, 결과, 협업/영향, 다음 개선 방향을 포함하고 평가 기준과 무관한 표현은 넣지 마세요.`,
  },
  {
    key: 'performance_report_draft',
    description: '피평가자 성과보고 내용 초안 생성',
    content: `당신은 피평가자가 성과보고 내용을 구체적으로 작성하도록 돕는 AI입니다.
입력된 과업명, 기간, 가중치, 기존 내용을 바탕으로 500자 이내의 성과보고 초안을 작성하세요.
업무 목적, 본인의 역할, 수행 내용, 결과/영향, 협업 내용을 자연스러운 문단으로 정리하세요.
입력에 없는 정량 성과나 사실은 만들지 말고, 확인이 필요한 부분은 완곡하게 표현하세요.
평가자가 기여방식과 기여범위를 판단할 수 있도록 행동 중심으로 작성하세요.`,
  },
  {
    key: 'feedback_improvement',
    description: '평가 피드백 문장 교정',
    content: `당신은 문서 교정 전문가입니다.
주어진 피드백의 의미와 사실관계는 유지하고 맞춤법, 띄어쓰기, 문장 흐름만 다듬으세요.
새로운 평가 내용이나 점수 해석을 추가하지 말고 500자 이내로 답변하세요.`,
  },
  {
    key: 'ai_feedback_chat',
    description: '평가 화면 AI 대화형 피드백 지원',
    content: `당신은 평가자가 피드백을 구체화하도록 돕는 AI 어시스턴트입니다.
질문에 간결하게 답하고, 과업 맥락과 평가 기준에 맞는 표현을 제안하세요.
답변은 300자 이내로 유지하세요.`,
  },
  {
    key: 'feedback_generic_review',
    description: '단일 피드백의 구체성 및 성의 검수',
    content: `다음 피드백이 성과평가에 적합한지 판단하세요.
구체적 행동, 성과, 영향, 개선 방향이 부족하면 GENERIC: 사유 형식으로 답하세요.
적절하면 GOOD: 적절한 피드백입니다 형식으로 답하세요.`,
  },
  {
    key: 'feedback_similarity_review',
    description: '신규 피드백과 기존 피드백의 유사도 검수',
    content: `신규 피드백과 기존 피드백 목록을 비교해 복사, 붙여넣기, 단어만 바꾼 유사 피드백인지 판단하세요.
문제가 있으면 DUPLICATE: 사유 형식으로 답하고, 문제없으면 OK: 적절한 피드백입니다 형식으로 답하세요.`,
  },
  {
    key: 'evaluation_feedback_review',
    description: '평가 저장 시 변경 피드백 일괄 AI 검수',
    content: `평가 저장 전 변경된 피드백들을 일괄 검수하세요.
각 피드백에 대해 구체성 부족, 의미 없는 표현, 기존 피드백과의 과도한 유사성만 판단합니다.
문제가 있는 항목만 JSON 배열로 답하세요.
응답 형식: [{"taskId":"...","summary":"간단한 사유"}]
문제가 없으면 [] 만 답하세요.`,
  },
  {
    key: 'ai_connection_test',
    description: 'AI 연결 상태 테스트',
    content: 'AI 연결 상태를 확인하기 위한 짧은 응답을 한국어로 작성하세요.',
  },
  {
    key: 'growth_suggestion',
    description: '피평가자 과업 점수·기여 맥락 기반 성장 제안',
    content: `당신은 OK금융그룹 기여도평가 시스템의 피평가자 성장 코치입니다.
주어진 과업 정보·점수·기여 맥락을 보고 다음 평가에서 한 단계 더 성장하기 위한 구체적 조언을 250자 이내로 작성하세요.
- 잘된 점은 한두 문장으로 짧게, 보완해야 할 점과 다음 행동을 명확히 제시하세요.
- 점수에 대한 일반론적 격려는 피하고, 기여방식(총괄/리딩/실무/지원)·기여범위(의존적/독립적/상호적/전략적)를 활용한 구체적 제안을 하세요.
- 한국어 존댓말로 작성하고, 별표·이모지·머리표는 쓰지 마세요.`,
  },
  {
    key: 'feedback_summary_evaluatee',
    description: '피평가자 본인이 받은 전체 피드백 요약',
    content: `당신은 피평가자에게 받은 피드백을 정리해 보여 주는 코칭 도우미입니다.
주어진 피드백 목록을 종합해 280자 이내로 요약하세요.
- 반복적으로 칭찬받은 강점 1~2개를 키워드 중심으로 정리합니다.
- 두 번 이상 지적된 약점이나 보완 영역 1개를 구체적으로 언급합니다.
- 다음 평가 라운드에서 시도해 볼 행동 1개를 한 문장으로 제안합니다.
- 한국어 존댓말, 평이한 표현. 별표·머리표·이모지는 쓰지 마세요.`,
  },
  {
    key: 'feedback_summary_evaluator',
    description: '평가자가 한 피평가자에게 작성한 피드백 요약',
    content: `당신은 평가자의 피드백 작성 결과를 정리하는 분석 도우미입니다.
평가자가 특정 피평가자에게 작성한 피드백들을 종합해 280자 이내로 요약하세요.
- 평가자가 일관되게 강조한 강점 키워드와 점수 분포 요지를 정리하세요.
- 피드백에서 누락된 측면(예: 기여범위 확장·후속 행동·정량적 결과 등)이 있으면 평가자에게 보완하라고 제안하세요.
- 한국어 존댓말, 평가자 시점. 별표·머리표·이모지는 쓰지 마세요.`,
  },
  {
    key: 'evaluator_qna_assistant',
    description: '평가자 AI 질의응답 (평가 기준·운영·피드백 작성 가이드)',
    content: `당신은 OK금융그룹 기여도평가 시스템의 평가자 전용 AI 어시스턴트입니다.
역할:
- 평가자가 평가 진행 중 가지는 의문(평가 기준, 점수 매트릭스 해석, 가중치, 피드백 작성 방법, 운영 절차 등)에 답변합니다.
- 평가 결과나 점수를 직접 결정하거나 피평가자 정보를 추측하지 않습니다.
- 답변은 600자 이내, 명확한 한국어 존댓말, 핵심 포인트는 글머리표(•)로 정리하세요.

평가 체계 핵심:
- 기여 방식 4단계: 총괄/주도, 리딩, 실무, 지원
- 기여 범위 4단계: 의존적, 독립적, 상호적, 전략적
- 매트릭스: [총괄=2/3/4/4 · 리딩=1/2/3/4 · 실무=1/1/2/3 · 지원=1/1/1/2] (열 순서: 의존→전략)
- 가중치 합은 100%여야 최종 저장 가능합니다.
- 피드백은 구체적 행동 → 결과 → 영향 → 개선 방향 순으로 작성을 권장합니다.

답변 가이드:
1. 질문이 시스템 기능과 무관하면 "기여도평가 운영과 관련된 질문에만 답변드릴 수 있습니다"라고 안내하세요.
2. 점수·등급에 영향을 주는 의사결정은 평가자 본인이 한다는 점을 명확히 전달하세요.
3. 모호한 질문은 추가 정보를 요청하세요.`,
  },
];

const DEFAULT_PROMPT_MAP = new Map(DEFAULT_PROMPTS.map((prompt) => [prompt.key, prompt]));

function mergePromptTemplates(remotePrompts: PromptTemplate[]) {
  const merged = new Map(DEFAULT_PROMPTS.map((prompt) => [prompt.key, prompt]));
  remotePrompts.forEach((prompt) => {
    merged.set(prompt.key, {
      ...merged.get(prompt.key),
      ...prompt,
      content: prompt.content || merged.get(prompt.key)?.content || '',
      description: prompt.description || merged.get(prompt.key)?.description || '',
    });
  });
  return Array.from(merged.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function fetchPrompt(key: string): Promise<string> {
  return fetch(`/api/prompt/${encodeURIComponent(key)}`)
    .then(res => {
      if (!res.ok) {
        const fallback = DEFAULT_PROMPT_MAP.get(key)?.content;
        if (fallback) return { content: fallback };
        throw new Error(`Failed to fetch prompt "${key}": ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
      if (!data || typeof data.content !== 'string') {
        const fallback = DEFAULT_PROMPT_MAP.get(key)?.content;
        if (fallback) return fallback;
        throw new Error(`Invalid prompt response for "${key}"`);
      }
      return data.content as string;
    })
    .catch(error => {
      const fallback = DEFAULT_PROMPT_MAP.get(key)?.content;
      if (fallback) return fallback;
      throw error;
    });
}

export function fetchAllPrompts(): Promise<PromptTemplate[]> {
  return fetch('/api/prompts')
    .then(res => {
      if (!res.ok) {
        return DEFAULT_PROMPTS;
      }
      return res.json();
    })
    .then(data => mergePromptTemplates(Array.isArray(data) ? data : []))
    .catch(() => DEFAULT_PROMPTS);
}

export function updatePrompt(key: string, content: string, description?: string): Promise<PromptTemplate> {
  return fetch(`/api/prompt/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content, description })
  })
    .then(res => {
      if (!res.ok) {
        throw new Error(`Failed to update prompt "${key}": ${res.status}`);
      }
      return res.json();
    });
}

// 새 프롬프트 생성 — 서버 PUT 이 upsert 라 동일 엔드포인트 사용. 키 중복 시 덮어쓰기 방지를 위해
// 호출부(폼)에서 사전에 fetchAllPrompts 로 키 중복을 검사한다.
export function createPrompt(key: string, content: string, description?: string): Promise<PromptTemplate> {
  return updatePrompt(key, content, description);
}

export function deletePrompt(key: string): Promise<{ ok: true; deleted_key: string }> {
  return fetch(`/api/prompt/${encodeURIComponent(key)}`, { method: 'DELETE' })
    .then(async (res) => {
      if (!res.ok) {
        const message = await res.text().catch(() => '');
        throw new Error(`Failed to delete prompt "${key}": ${res.status} ${message}`);
      }
      return res.json();
    });
}

// GPT‑OSS API 설정 (인증 없이 로컬 엔드포인트)
const GPT_OSS_URL = `http://172.17.170.201:8000/v1/chat/completions`;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface FeedbackSuggestion {
  type: 'recommendation' | 'correction' | 'warning' | 'improvement';
  content: string;
  explanation?: string;
}

/**
 * GPT‑OSS에 프롬프트를 전달하고 응답 텍스트를 반환합니다.
 */

async function callGptOss(prompt: string, options: { timeoutMs?: number } = {}): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);

  try {

    const response = await fetch(GPT_OSS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gpt-oss-120b',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GPT‑OSS 오류: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message.content;
    if (!content) {
      throw new Error('GPT‑OSS 응답에서 텍스트를 찾을 수 없습니다');
    }

    // 500자 제한 강화 - 완전한 문장으로 끝내기
    if (content.length > 500) {
      const truncated = content.substring(0, 500);
      const lastSentenceEnd = Math.max(
        truncated.lastIndexOf('.'),
        truncated.lastIndexOf('다.'),
        truncated.lastIndexOf('요.'),
        truncated.lastIndexOf('습니다.'),
        truncated.lastIndexOf('다!'),
        truncated.lastIndexOf('요!'),
        truncated.lastIndexOf('습니다!')
      );

      if (lastSentenceEnd > 300) {
        return truncated.substring(0, lastSentenceEnd + 1);
      } else {
        return truncated + '...';
      }
    }

    return content;
  } catch (error) {
    console.warn('⚠️ GPT‑OSS 호출 오류:', error);
    // Return a fallback message to avoid breaking the UI when the OSS service is unreachable or returns non‑JSON.
    return '⚠️ GPT‑OSS 호출에 실패했습니다. 관리자에게 문의해 주세요.';
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * 피평가자 성과보고 내용 초안 생성
 */
export async function generatePerformanceReportDraft(input: {
  taskTitle: string;
  currentDescription?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  weight?: number | null;
}): Promise<string> {
  const template = await fetchPrompt('performance_report_draft');
  const guide = await fetchPrompt('evaluation_guide');
  const period =
    input.startDate || input.endDate
      ? `${input.startDate || '시작일 미기재'} ~ ${input.endDate || '종료일 미기재'}`
      : '미기재';
  const prompt = `${template}

[평가 기준]
${guide}

**과업명:** ${input.taskTitle}
**기간:** ${period}
**가중치:** ${input.weight == null ? '미기재' : `${input.weight}%`}
${input.currentDescription?.trim() ? `**기존 작성 내용:** ${input.currentDescription.trim()}` : ''}

**요구사항:**
1. 피평가자 본인이 작성한 성과보고 문장처럼 작성
2. 기존 작성 내용이 있으면 핵심 사실은 유지하고 더 명확하게 보완
3. 과장된 표현, 없는 수치, 평가자 관점의 점수 판단은 제외
4. 500자 이내, 한국어 존댓말 또는 보고서 문체로 완성`;

  return await callGptOss(prompt);
}

/**
 * 피드백 추천 생성 (과업 정보 기반)
 */
export async function generateFeedbackRecommendation(
  taskTitle: string,
  taskDescription: string,
  score: number,
  contributionMethod: string,
  contributionScope: string,
  currentFeedback?: string
): Promise<string> {
  const template = await fetchPrompt('feedback_recommendation');
  const guide = await fetchPrompt('evaluation_guide');
  const prompt = `${template}

   [평가 기준]
   ${guide}
   
   **과업명:** "${taskTitle}"
   **과업내용:** "${taskDescription}"
  **기여방식:** ${contributionMethod}
  **기여범위:** ${contributionScope}
  **점수:** ${score}점
   
  **요구사항:**
  1. 평가가 GUIDE 철학과 기준을 반드시 반영
  2. 500자를 초과하지 않도록
  3. 구체적이고 실행 가능한 개선 방안 포함
   
  ${currentFeedback ? `**기존 피드백:** "${currentFeedback}"` : ''}`;

  return await callGptOss(prompt);
}

/**
 * 피드백 문장 교정 (문법·표현 개선)
 */
export async function improveFeedback(
  currentFeedback: string,
  taskTitle: string,
  score: number
): Promise<string> {
  const template = await fetchPrompt('feedback_improvement');
  const prompt = `${template}

**교정 원칙:**
1. 내용·의미 절대 변경 금지
2. 새로운 내용 추가 금지
3. 기존 내용 삭제 금지
4. 문장 순서 변경 금지

**교정 범위:**
1. 맞춤법·띄어쓰기 교정
2. 문법 오류 수정
3. 어색한 표현 자연스럽게 수정
4. 경어체統一 (하십시오체)
5. 문장 부호 정리
6. **절대 500자를 넘지 않도록** 유지

**현재 피드백:** "${currentFeedback}"
**과업명:** ${taskTitle}
**점수:** ${score}점

위 피드백 의미를 그대로 유지하고, 오직 문법·표현만 교정해주세요. **500자 이내**로 완전한 문장으로 끝맺음해주세요.`;

  return await callGptOss(prompt);
}

/**
 * 평가자 AI 질의응답 — 평가 기준/운영/피드백 작성 가이드
 */
export type EvaluatorQnaTurn = { role: 'user' | 'assistant'; content: string };

export async function askEvaluatorQuestion(
  question: string,
  history: EvaluatorQnaTurn[] = [],
): Promise<string> {
  const systemPrompt = await fetchPrompt('evaluator_qna_assistant');
  const recent = history.slice(-6);

  const transcript = recent
    .map((turn) => `${turn.role === 'user' ? '평가자' : 'AI'}: ${turn.content}`)
    .join('\n');

  const prompt = `${systemPrompt}

이전 대화:
${transcript || '(없음)'}

평가자 질문:
${question.trim()}

답변:`;

  return await callGptOss(prompt, { timeoutMs: 20000 });
}

/**
 * 일반적인 AI 채팅
 */
export async function chatWithAI(
  userMessage: string,
  context: {
    taskTitle: string;
    taskDescription: string;
    score?: number;
    contributionMethod?: string;
    contributionScope?: string;
  }
): Promise<string> {
  const template = await fetchPrompt('ai_feedback_chat');
  const guide = await fetchPrompt('evaluation_guide');
  const prompt = `${template}

   [평가 기준]
   ${guide}
   
   **과업:** ${context.taskTitle}
  **질문:** ${userMessage}
  **추가 정보:** ${context.taskDescription}
  ${context.score ? `**점수:** ${context.score}` : ''}
  ${context.contributionMethod ? `**기여방식:** ${context.contributionMethod}` : ''}
  ${context.contributionScope ? `**기여범위:** ${context.contributionScope}` : ''}
   
  친근하고 간결하게, 300자 이내로 답변해주세요.`;

  return await callGptOss(prompt);
}

/**
 * 피평가자 과업 맥락 기반 성장 제안 (피평가자 화면 AI 성장 제안)
 */
export async function generateGrowthSuggestion(input: {
  taskTitle: string;
  taskDescription?: string | null;
  score: number | null;
  contributionMethod?: string | null;
  contributionScope?: string | null;
  feedback?: string | null;
  growthLevel?: number | null;
}): Promise<string> {
  const template = await fetchPrompt('growth_suggestion');
  const guide = await fetchPrompt('evaluation_guide');
  const prompt = `${template}

[평가 기준]
${guide}

**과업명:** ${input.taskTitle}
**과업내용:** ${input.taskDescription || '(미기재)'}
**기여방식:** ${input.contributionMethod || '(미기재)'}
**기여범위:** ${input.contributionScope || '(미기재)'}
**점수:** ${input.score == null ? '평가 전' : `${input.score}점`}
${input.growthLevel != null ? `**피평가자 성장레벨:** Lv.${input.growthLevel}` : ''}
${input.feedback ? `**받은 피드백:** ${input.feedback}` : ''}

위 정보를 바탕으로 다음 평가에서 한 단계 성장하기 위한 제안을 250자 이내로 작성하세요.`;
  return await callGptOss(prompt);
}

/**
 * 피평가자 본인이 받은 피드백 목록 요약 (피평가자 피드백 이력 화면)
 */
export type FeedbackForSummary = {
  taskTitle: string;
  content: string;
  score?: number | null;
  evaluatorName?: string | null;
};

export async function generateFeedbackSummaryForEvaluatee(
  feedbacks: FeedbackForSummary[],
): Promise<string> {
  if (feedbacks.length === 0) return '아직 받은 피드백이 없습니다.';
  const template = await fetchPrompt('feedback_summary_evaluatee');
  const list = feedbacks
    .slice(0, 30)
    .map(
      (f, i) =>
        `${i + 1}. [${f.taskTitle}${f.score != null ? ` · ${f.score}점` : ''}] ${f.content}`,
    )
    .join('\n');
  const prompt = `${template}

[받은 피드백 목록]
${list}

위 피드백을 종합한 요약을 280자 이내로 작성하세요.`;
  return await callGptOss(prompt);
}

/**
 * 평가자가 특정 피평가자에게 작성한 피드백 요약 (평가자 피드백 내역 화면)
 */
export async function generateFeedbackSummaryForEvaluator(
  evaluateeName: string,
  feedbacks: FeedbackForSummary[],
): Promise<string> {
  if (feedbacks.length === 0) {
    return `${evaluateeName}님에게 아직 작성한 피드백이 없습니다.`;
  }
  const template = await fetchPrompt('feedback_summary_evaluator');
  const list = feedbacks
    .slice(0, 30)
    .map(
      (f, i) =>
        `${i + 1}. [${f.taskTitle}${f.score != null ? ` · ${f.score}점` : ''}] ${f.content}`,
    )
    .join('\n');
  const prompt = `${template}

**피평가자:** ${evaluateeName}

[작성한 피드백 목록]
${list}

위 피드백을 종합한 요약을 280자 이내로 작성하세요.`;
  return await callGptOss(prompt);
}

/**
 * Gemini API 키 확인 (인증이 없으므로 항상 true 반환)
 */
export function checkGeminiKey(): boolean {
  return true;
}

/**
 * Gemini 연결 테스트 (대체 API 호출)
 */
export async function testGeminiConnection(): Promise<{ success: boolean; response?: string; error?: string }> {
  try {
    const testPrompt = await fetchPrompt('ai_connection_test');
    const response = await callGptOss(testPrompt);
    return { success: true, response };
  } catch (error) {
    console.error('❌ GPT‑OSS 연결 실패:', error);
    return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' };
  }
}

/**
 * 작성 중인 프롬프트 초안을 저장하지 않고 즉석에서 LLM에 보내 응답을 받아온다.
 * HR 프롬프트 관리 화면의 "테스트" 버튼이 사용.
 */
export async function testPromptDraft(
  systemPrompt: string,
  userInput?: string,
): Promise<{ success: boolean; response?: string; error?: string }> {
  const trimmed = systemPrompt.trim();
  if (!trimmed) {
    return { success: false, error: '프롬프트 내용이 비어 있습니다.' };
  }
  const sample = userInput?.trim() || '위 지시 사항이 정상적으로 적용되는지 한 문단으로 답해 주세요.';
  try {
    const merged = `${trimmed}\n\n[테스트 입력]\n${sample}`;
    const response = await callGptOss(merged);
    return { success: true, response };
  } catch (error) {
    console.error('❌ 프롬프트 초안 테스트 실패:', error);
    return { success: false, error: error instanceof Error ? error.message : '알 수 없는 오류' };
  }
}

export type FeedbackReviewItem = {
  taskId: string;
  taskTitle: string;
  feedback: string;
  score?: number | null;
  contributionMethod?: string | null;
  contributionScope?: string | null;
};

export type FeedbackReviewWarning = {
  taskId: string;
  taskTitle?: string;
  summary: string;
};

export async function reviewEvaluationFeedbacks(
  items: FeedbackReviewItem[],
  existingFeedbacks: string[],
  evaluatorName: string,
): Promise<{ warnings: FeedbackReviewWarning[]; skipped: boolean }> {
  const reviewItems = items
    .map((item) => ({
      ...item,
      feedback: item.feedback.trim(),
    }))
    .filter((item) => item.feedback);

  if (reviewItems.length === 0) {
    return { warnings: [], skipped: true };
  }

  try {
    const template = await fetchPrompt('evaluation_feedback_review');
    const prompt = `${template}

평가자: ${evaluatorName}

변경된 피드백:
${JSON.stringify(reviewItems, null, 2)}

비교할 기존 피드백:
${JSON.stringify(existingFeedbacks.slice(0, 12), null, 2)}

문제가 있는 항목만 JSON 배열로 답하세요. 다른 설명 문장은 쓰지 마세요.`;

    const result = await callGptOss(prompt, { timeoutMs: 15000 });
    const jsonText = result.match(/\[[\s\S]*\]/)?.[0];
    if (!jsonText) {
      return { warnings: [], skipped: true };
    }

    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) {
      return { warnings: [], skipped: true };
    }

    const warnings = parsed
      .map((item: any) => ({
        taskId: String(item.taskId ?? ''),
        taskTitle: item.taskTitle ? String(item.taskTitle) : undefined,
        summary: String(item.summary ?? '').trim(),
      }))
      .filter((item) => item.taskId && item.summary);

    return { warnings, skipped: false };
  } catch (error) {
    console.warn('AI 피드백 일괄 검수 실패:', error);
    return { warnings: [], skipped: true };
  }
}

/* ---------- 기존 Gemini 파일에 포함된 유틸리티 함수들 (detectMeaninglessContent, detectGenericFeedback, checkSimilarFeedback 등) ----------
   이 부분은 그대로 복사해도 무방합니다. 아래는 원본과 동일하게 유지됩니다. ---------- */

function detectMeaninglessContent(feedback: string): { isValid: boolean; reason?: string } {
  const text = feedback.trim();

  // 1. 연속된 같은 문자 감지 (3개 이상)
  const repeatedCharPattern = /(.)\1{2,}/g;
  const repeatedMatches = text.match(repeatedCharPattern);
  if (repeatedMatches && repeatedMatches.some(match => match.length >= 5)) {
    return { isValid: false, reason: '의미없는 문자 반복이 감지되었습니다 (예: "ㅋㅋㅋㅋㅋ", ".....", "!!!!")' };
  }

  // 2. 지나친 공백 사용 감지
  const excessiveSpaces = /\s{5,}/g;
  if (excessiveSpaces.test(text)) {
    return { isValid: false, reason: '문장을 늘리기 위한 과도한 공백 사용이 감지되었습니다' };
  }

  // 3. 의미없는 문자 나열 감지
  if (text.includes('.....') || text.includes('!!!!!')) {
    return { isValid: false, reason: '의미없는 특수문자 반복이 감지되었습니다' };
  }

  // 자음만 5개 이상 연속
  const consonants = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  let consonantCount = 0;
  for (const char of text) {
    if (consonants.includes(char)) {
      consonantCount++;
      if (consonantCount >= 5) {
        return { isValid: false, reason: '의미없는 자음 나열이 감지되었습니다' };
      }
    } else {
      consonantCount = 0;
    }
  }

  // 감정표현 반복
  if (/ㅋ{3,}|ㅎ{3,}|ㅜ{3,}|ㅠ{3,}/.test(text)) {
    return { isValid: false, reason: '의미없는 감정표현 반복이 감지되었습니다' };
  }

  // 단순 반복 문장 감지
  const sentences = text.split(/[.!?]/);
  const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
  if (sentences.length >= 3 && uniqueSentences.size < sentences.length * 0.7) {
    return { isValid: false, reason: '반복적인 문장으로 글자 수를 늘린 것으로 보입니다' };
  }

  // 과도한 이모지 사용
  const commonEmojis = ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  let emojiCount = 0;
  for (const char of text) {
    if (commonEmojis.includes(char)) {
      emojiCount++;
    }
  }
  if (emojiCount > text.length * 0.1) {
    return { isValid: false, reason: '과도한 이모지 사용으로 인한 의미없는 내용이 감지되었습니다' };
  }

  return { isValid: true };
}

async function detectGenericFeedback(feedback: string): Promise<{ isGeneric: boolean; reason?: string }> {
  const text = feedback.trim();

  // 1. 기본적인 일반적 표현 패턴 검사
  const genericPatterns = [
    /^(좋았습니다?|잘했습니다?|수고했습니다?|고생했습니다?)\.?$/i,
    /^(열심히\s*했습니다?|성실했습니다?|적극적이었습니다?)\.?$/i,
    /^(계속\s*이런\s*식으로\s*해주세요|앞으로도\s*잘\s*부탁드립니다?)\.?$/i,
    /^(만족스럽습니다?|괜찮습니다?|무난합니다?)\.?$/i,
  ];

  for (const pattern of genericPatterns) {
    if (pattern.test(text)) {
      return { isGeneric: true, reason: '구체적이지 않은 일반적인 표현입니다. 구체적인 성과나 개선점을 언급해주세요.' };
    }
  }

  // 2. 길이는 충분하지만 의미 없는 반복
  const words = text.split(/\s+/);
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  if (words.length >= 10 && uniqueWords.size < words.length * 0.6) {
    return { isGeneric: true, reason: '단어가 과도하게 반복되어 구체성이 부족합니다.' };
  }

  // 3. AI를 활용한 고급 일반성 검사
  try {
    const template = await fetchPrompt('feedback_generic_review');
    const prompt = `${template}
     
     다음 피드백이 성과평가에 적합한 구체적이고 의미 있는 피드백인지 평가해주세요.
     
    **검사할 피드백:**
    "${text}"
     
    **판정 기준:**
    1. 구체적인 성과·행동 언급 여부
    2. 개선점·향후 방향 제시 여부
    3. 평가가 GUIDE 기준(기여방식·기여범위 등)과 연관성
    4. 단순 격려·일반 표현에 그치지 않는가
    5. 실질적인 도움이 되는가
     
    **판정 결과:**
    - 구체적이고 적절한 피드백: "GOOD: 적절한 피드백입니다"
    - 일반적이거나 부적절한 피드백: "GENERIC: [구체적인 이유]"
     
    평가가 GUIDE 기준에 따라 객관적으로 판정해주세요.`;
    const result = await callGptOss(prompt);
    if (result.startsWith('GENERIC:')) {
      return { isGeneric: true, reason: result.replace('GENERIC:', '').trim() || '구체성이 부족한 피드백입니다' };
    }
  } catch (error) {
    console.warn('⚠️ AI 일반성 검사 실패:', error);
  }

  return { isGeneric: false };
}

/**
 * 피드백 중복 검사 (다른 피평가자들과 비교)
 */
export async function checkSimilarFeedback(
  newFeedback: string,
  existingFeedbacks: string[],
  evaluatorName: string
): Promise<{ isDuplicate: boolean; summary: string }> {
  // 0. 빈 피드백 검사
  if (!newFeedback || !newFeedback.trim()) {
    return { isDuplicate: true, summary: '피드백을 입력해주세요. 빈 피드백은 저장할 수 없습니다.' };
  }

  if (existingFeedbacks.length === 0) {
    const genericCheck = await detectGenericFeedback(newFeedback);
    if (genericCheck.isGeneric) {
      return { isDuplicate: true, summary: genericCheck.reason || '구체성이 부족한 피드백입니다' };
    }
    return { isDuplicate: false, summary: '비교할 다른 피드백이 없습니다.' };
  }

  // 1. 의미없는 내용 감지
  const meaningfulnessCheck = detectMeaninglessContent(newFeedback);
  if (!meaningfulnessCheck.isValid) {
    return { isDuplicate: true, summary: meaningfulnessCheck.reason || '부적절한 내용이 감지되었습니다' };
  }

  // 2. 일반적이고 단순한 표현 감지 (AI 강화)
  const genericCheck = await detectGenericFeedback(newFeedback);
  if (genericCheck.isGeneric) {
    return { isDuplicate: true, summary: genericCheck.reason || '구체성이 부족한 피드백입니다' };
  }

  // 3. 기본 길이·문장 구조 검사
  const feedbackLength = newFeedback.trim().length;
  const sentenceCount = newFeedback.split(/[.!?다요]\s*/).filter(s => s.trim().length > 0).length;

  if (feedbackLength < 30) {
    return { isDuplicate: true, summary: `너무 짧은 피드백입니다 (${feedbackLength}자). 최소 30자 이상의 구체적인 피드백을 작성해주세요.` };
  }

  if (sentenceCount <= 1 && feedbackLength < 50) {
    return { isDuplicate: true, summary: `너무 단순한 피드백입니다 (${sentenceCount}문장). 더 구체적이고 상세한 피드백을 작성해주세요.` };
  }

  const template = await fetchPrompt('feedback_similarity_review');
  const guide = await fetchPrompt('evaluation_guide');
  const prompt = `${template}

   [평가 기준]
   ${guide}
   
   평가자 "${evaluatorName}"가 다른 피평가자들에게 작성한 기존 피드백들과 새로운 피드백을 비교하여 성의없는 피드백을 감지해주세요.
   
  **감지 기준:**
  1. 복사·붙여넣기 (95% 이상 동일)
  2. 단어 몇 개만 바꾼 경우 (85% 이상 유사)
  3. 의미없는 반복적 표현 사용
  4. 평가가 GUIDE에 맞지 않는 부적절한 내용
  5. 구체성이 부족한 일반적인 표현만 사용
   
  **새로운 피드백:**
  "${newFeedback}"
   
  **기존 피드백들:**
  ${existingFeedbacks.slice(0, 10).map((fb, index) => `${index + 1}. "${fb}"`).join('\n')}
   
  **응답 형식:**
  성의없는 피드백이 감지되면: "DUPLICATE: [감지된 이유를 간단히 요약]"
  문제없으면: "OK: 적절한 피드백입니다"
   
  평가가 GUIDE 기준에 따라 분석하여 응답해주세요.`;

  try {
    const result = await callGptOss(prompt);
    if (result.startsWith('DUPLICATE:')) {
      return { isDuplicate: true, summary: result.replace('DUPLICATE:', '').trim() };
    } else {
      return { isDuplicate: false, summary: result.replace('OK:', '').trim() };
    }
  } catch (error) {
    console.warn('⚠️ AI 중복 검사 실패:', error);
    return { isDuplicate: false, summary: '중복 검사 중 오류가 발생했습니다.' };
  }
}
