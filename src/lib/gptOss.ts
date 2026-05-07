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
