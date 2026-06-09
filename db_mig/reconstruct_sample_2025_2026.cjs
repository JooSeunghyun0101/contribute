/**
 * reconstruct_sample_2025_2026.js
 *
 * 현실적 샘플데이터 재구성 — 2025·2026 평가기간 전체를 결정적 PRNG 기반으로 재생성.
 *
 * 불변식 준수:
 *   1) employees 마스터·evaluation_periods(2건) 보존.
 *   2) score = MATRIX_SCORES[methodIdx][scopeIdx] 항상 정합.
 *   3) evaluation당 task 가중치 합=100 (의도 결함 17건 제외).
 *   4) evaluation_status = tasks score 상태와 동기화(completed/in-progress).
 *   5) feedback_history.created_at 연도 = task end_date 연도 (12월 종료 클램프).
 *   6) 순환 FK 2-pass: evaluations INSERT→assignment_history INSERT→evaluations UPDATE.
 *   7) UK(task_uuid, evaluator_id) 위반 없음 — 전보는 evaluation 단위 분할.
 *   8) 멱등: 단일 트랜잭션 BEGIN, FK 역순 DELETE 후 재INSERT, ROLLBACK/COMMIT.
 *   9) DRY_RUN 기본: RECONSTRUCT_COMMIT!=='1' 이면 ROLLBACK.
 *
 * 실행:
 *   DATABASE_URL=... node db_mig/reconstruct_sample_2025_2026.cjs
 *   RECONSTRUCT_COMMIT=1 DATABASE_URL=... node db_mig/reconstruct_sample_2025_2026.cjs
 */

'use strict';

const crypto = require('crypto');
const { Pool } = require('pg');

// ─────────────────────────────────────────────
// 환경·설정
// ─────────────────────────────────────────────
const CONN = process.env.DATABASE_URL;
if (!CONN) {
  console.error('DATABASE_URL 환경변수가 필요합니다.');
  process.exit(1);
}

const DRY_RUN = process.env.RECONSTRUCT_COMMIT !== '1';
const RECONSTRUCT_TAG = 'RB-2026-06';

// 평가기간 고정 ID
const PERIOD_2025 = '8dd010d4-27c2-48e0-b371-5766b6417e64';
const PERIOD_2026 = '5e96660b-dea5-4995-9fd5-4d9d202a52cc';

// ─────────────────────────────────────────────
// PRNG — mulberry32 + SHA-256 결정적 시드
// ─────────────────────────────────────────────
function sha256seed(str) {
  const h = crypto.createHash('sha256').update(str).digest('hex');
  return parseInt(h.slice(0, 8), 16) >>> 0;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePrng(id, salt) {
  return mulberry32(sha256seed(id + ':' + salt));
}

// uniform [lo, hi)
function randFloat(rng, lo, hi) { return lo + rng() * (hi - lo); }
// uniform integer [lo, hi]
function randInt(rng, lo, hi) { return Math.floor(randFloat(rng, lo, hi + 1 - 1e-9)); }
// normal approx via Box-Muller
function randNormal(rng, mean, sd) {
  const u = rng(), v = rng();
  const n = Math.sqrt(-2 * Math.log(Math.max(u, 1e-12))) * Math.cos(2 * Math.PI * v);
  return mean + n * sd;
}
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// weighted sample from array of {item, weight}
function weightedSample(rng, choices) {
  const total = choices.reduce((s, c) => s + c.weight, 0);
  let r = rng() * total;
  for (const c of choices) { r -= c.weight; if (r <= 0) return c.item; }
  return choices[choices.length - 1].item;
}

// ─────────────────────────────────────────────
// 매트릭스 정의
// ─────────────────────────────────────────────
const METHODS = ['총괄', '리딩', '실무', '지원'];
const SCOPES = ['의존적', '독립적', '상호적', '전략적'];
const MATRIX_SCORES = [
  [2, 3, 4, 4], // 총괄
  [1, 2, 3, 4], // 리딩
  [1, 1, 2, 3], // 실무
  [1, 1, 1, 2], // 지원
];

// score → [(methodIdx, scopeIdx)] 역맵
const SCORE_CELLS = {};
for (let m = 0; m < 4; m++) {
  for (let s = 0; s < 4; s++) {
    const sc = MATRIX_SCORES[m][s];
    if (!SCORE_CELLS[sc]) SCORE_CELLS[sc] = [];
    SCORE_CELLS[sc].push([m, s]);
  }
}
// 결과: score1=6칸, score2=4칸, score3=3칸, score4=3칸

function getMatrixScore(mIdx, sIdx) { return MATRIX_SCORES[mIdx][sIdx]; }

// 평가자 코호트별 셀 가중 (method 선호)
// 동일 targetScore의 후보 셀들 중 성향에 따라 가중 샘플
function methodWeightForCohort(cohort, mIdx) {
  // mIdx: 0=총괄, 1=리딩, 2=실무, 3=지원
  const prefs = {
    LENIENT_FLAT:    [0.45, 0.30, 0.15, 0.10],
    STRICT_FLAT:     [0.05, 0.10, 0.40, 0.45],
    DISCRIMINATING:  [0.25, 0.30, 0.30, 0.15],
    HARSH_DISCRIM:   [0.10, 0.20, 0.40, 0.30],
    NOISY:           [0.25, 0.25, 0.25, 0.25],
  };
  return (prefs[cohort] || prefs.DISCRIMINATING)[mIdx];
}

function pickCell(rng, targetScore, cohort) {
  const cells = SCORE_CELLS[targetScore];
  const choices = cells.map(([m, s]) => ({ item: [m, s], weight: methodWeightForCohort(cohort, m) }));
  return weightedSample(rng, choices);
}

// ─────────────────────────────────────────────
// 평가자 코호트 배정 (결정적)
// 누적분포: LENIENT_FLAT=33, STRICT_FLAT=13, DISCRIMINATING=82, HARSH_DISCRIM=20, NOISY=17 (총 165)
// ─────────────────────────────────────────────
const COHORT_THRESHOLDS = [
  { cohort: 'LENIENT_FLAT',   pct: 33 / 165 },
  { cohort: 'STRICT_FLAT',    pct: 46 / 165 },
  { cohort: 'DISCRIMINATING', pct: 128 / 165 },
  { cohort: 'HARSH_DISCRIM',  pct: 148 / 165 },
  { cohort: 'NOISY',          pct: 1.0 },
];

function assignCohort(evaluatorId) {
  const rng = makePrng(evaluatorId, 'cohort');
  const r = rng();
  for (const t of COHORT_THRESHOLDS) {
    if (r <= t.pct) return t.cohort;
  }
  return 'NOISY';
}

// 코호트별 bias_e, sigma_e
function getEvaluatorParams(evaluatorId) {
  const cohort = assignCohort(evaluatorId);
  const rngB = makePrng(evaluatorId, 'biasE');
  const rngS = makePrng(evaluatorId, 'sigmaE');
  let bias_e, sigma_e;
  switch (cohort) {
    case 'LENIENT_FLAT':
      bias_e = randFloat(rngB, 0.6, 0.9);
      sigma_e = 0.15;
      break;
    case 'STRICT_FLAT':
      bias_e = randFloat(rngB, -1.0, -0.7);
      sigma_e = 0.20;
      break;
    case 'DISCRIMINATING':
      bias_e = randNormal(rngB, 0, 0.25);
      sigma_e = randFloat(rngS, 0.55, 0.75);
      break;
    case 'HARSH_DISCRIM':
      bias_e = -0.3 + randNormal(rngB, 0, 0.1);
      sigma_e = 0.70;
      break;
    case 'NOISY':
      bias_e = randNormal(rngB, 0, 0.4);
      sigma_e = 1.0;
      break;
    default:
      bias_e = 0;
      sigma_e = 0.6;
  }
  return { cohort, bias_e, sigma_e };
}

// ─────────────────────────────────────────────
// 피평가자 ability
// ─────────────────────────────────────────────
function getAbility2025(employeeId, growthLevel) {
  const rng = makePrng(employeeId, 'ability2025');
  const base = randNormal(rng, 0, 1);
  // growth_level과 약한 상관(≈0.15)만 — 상관이 크면 고레벨이 점수에서 추가로 밀려 올라
  // 유효 레벨기울기가 커지고 4점이 과다해진다(점수 인플레). (growth 1~4, center 2.5)
  return base * 0.98 + 0.15 * (growthLevel - 2.5) / 1.1;
}

function getAbility2026(employeeId, ability2025) {
  const rng = makePrng(employeeId, 'ability2026delta');
  const rho = 0.75;
  const trend = 0.1;
  return rho * ability2025 + Math.sqrt(1 - rho * rho) * randNormal(rng, 0, 1) + trend;
}

// ─────────────────────────────────────────────
// 점수 생성 파이프라인
// ─────────────────────────────────────────────
function generateScore(rng, growthLevel, abilityZ, bias_e, sigma_e) {
  const noise = randNormal(rng, 0, sigma_e);
  // 점수는 성장레벨에 1:1이 아니라 부분적으로만 연동(회귀, 계수 0.55)된다.
  // 고레벨은 기대수준이 높아 갭이 음(-, near/below)으로, 저레벨은 양(+, exceed)으로 기울고,
  // 모집단 점수 중심을 ~2.6에 둬 4점 과다·exceed 편중(점수 인플레)을 방지한다.
  const POP_CENTER = 2.45;
  const LEVEL_COEF = 0.45;
  const latent = clamp(
    POP_CENTER + LEVEL_COEF * (growthLevel - 2.5) + abilityZ * 0.8 + bias_e + noise,
    0.5,
    4.4,
  );
  const target = Math.max(1, Math.min(4, Math.round(latent)));
  return target;
}

// ─────────────────────────────────────────────
// 과업 가중치 생성 (디리클레 α=2.5)
// ─────────────────────────────────────────────
function generateWeights(rng, count) {
  // 디리클레 샘플링: 각 감마(α=2.5) 샘플 생성 후 정규화
  const gammas = [];
  for (let i = 0; i < count; i++) {
    // 감마(α=2.5) 근사: 합산 지수 방법 (Marsaglia & Tsang 간소화)
    let g = 0;
    const alpha = 2.5;
    // 정수 부분 floor(alpha)=2 번 지수 합산 + 잔차
    for (let k = 0; k < 2; k++) {
      g -= Math.log(Math.max(rng(), 1e-12));
    }
    // 잔차 0.5: Wilson-Hilferty 근사
    const u = rng();
    const v = rng();
    const n = Math.sqrt(-2 * Math.log(Math.max(u, 1e-12))) * Math.cos(2 * Math.PI * v);
    g += Math.max(0, 0.5 * (1 + n * Math.sqrt(2 / (9 * 0.5)) - Math.pow(1 - 2 / (9 * 0.5), 3)));
    gammas.push(g);
  }
  const total = gammas.reduce((s, x) => s + x, 0);
  const raw = gammas.map(x => x / total * 100);

  // 정수로 반올림하되 합=100 보정 (최대 weight에 잔차 흡수)
  let rounded = raw.map(x => Math.round(x));
  const diff = 100 - rounded.reduce((s, x) => s + x, 0);
  if (diff !== 0) {
    // 잔차를 가장 큰 값에 흡수
    const maxIdx = rounded.indexOf(Math.max(...rounded));
    rounded[maxIdx] += diff;
  }
  // 음수 방어: 최소 1
  for (let i = 0; i < rounded.length; i++) {
    if (rounded[i] < 1) { rounded[i] = 1; }
  }
  // 재보정
  const sum2 = rounded.reduce((s, x) => s + x, 0);
  if (sum2 !== 100) {
    const maxIdx = rounded.indexOf(Math.max(...rounded));
    rounded[maxIdx] += 100 - sum2;
  }
  return rounded;
}

// ─────────────────────────────────────────────
// 의도 결함 주입 판단
// ─────────────────────────────────────────────
// 결정적: hash(evalId) % 85 === 0 → 가중치 결함
// 약 1449 / 85 ≈ 17건 (무결성 패널 실히트용 의도 결함)
function isWeightDefectEval(evalId) {
  const h = sha256seed(evalId + ':weight_defect');
  return (h % 85) === 0;
}

function applyWeightDefect(rng, weights) {
  // 합을 95/98/102/105 중 하나로 조작
  const deltas = [-5, -2, 2, 5];
  const delta = deltas[randInt(rng, 0, 3)];
  const adj = [...weights];
  // 첫 번째 task에 delta 적용 (음수 방어: 최소 1 유지)
  adj[0] = Math.max(1, adj[0] + delta);
  return adj;
}

// ─────────────────────────────────────────────
// 의견 생성
// ─────────────────────────────────────────────
const FEEDBACK_VOCAB = {
  exceed: {
    openers: ['탁월한 기여를', '기대수준을 명확히 초과하여', '주도적으로 과업을 이끌며', '성과가 팀을 넘어 조직에 뚜렷하게 연결되어'],
    actions: ['완수했습니다', '실현했습니다', '달성했습니다', '구현했습니다'],
    adv: ['매우', '현저히', '뚜렷하게', '두드러지게'],
    qualifiers: ['초과달성', '탁월한 성과', '주도적 기여', '전략적 기여', '선도적 역할'],
    followup: ['다음 단계 역할로의 성장 가능성을 보였습니다.', '향후 더 높은 수준의 과업을 기대합니다.', '조직 전체에 긍정적 영향을 미쳤습니다.', '지속적인 성과 창출을 기대합니다.'],
  },
  meet: {
    openers: ['안정적으로 과업을', '기대수준에 부합하게', '책임 범위 내에서 충실히', '기한과 품질을 준수하며'],
    actions: ['수행했습니다', '완료했습니다', '처리했습니다', '진행했습니다'],
    adv: ['안정적으로', '충실히', '성실하게', '꾸준히'],
    qualifiers: ['기준 충족', '역할 수행', '안정적 성과', '책임감 있는 수행'],
    followup: ['앞으로도 지속적인 성과를 기대합니다.', '역할 범위의 확장을 기대합니다.', '현재의 수행 수준을 유지해 주시기 바랍니다.', '팀 목표 달성에 실질적으로 기여했습니다.'],
  },
  near: {
    openers: ['주요 결과는 만들었으나', '기대수준에 근접했으나', '역할 수행은 이루어졌으나', '과업은 완료되었으나'],
    actions: ['보완이 필요합니다', '개선이 요구됩니다', '미흡한 부분이 있었습니다', '추가 노력이 필요합니다'],
    adv: ['일부', '다소', '부분적으로'],
    qualifiers: ['독립성 부족', '완성도 미흡', '범위 제한', '일정 준수 필요'],
    followup: ['향후 보완을 통해 성장하기를 기대합니다.', '다음 평가기간에는 개선된 모습을 기대합니다.', '구체적인 역량 강화 계획 수립을 권장합니다.', '지속적인 자기계발이 필요합니다.'],
  },
  below: {
    openers: ['기대수준에 미치지 못하여', '성장레벨 대비 기여가 제한적이었으며', '결과 품질 측면에서', '역할 책임 이행에 있어'],
    actions: ['재점검이 필요합니다', '미달성으로 평가됩니다', '개선이 시급합니다', '보완이 필요합니다'],
    adv: ['상당히', '전반적으로', '전체적으로'],
    qualifiers: ['기대 미달', '역할 책임 미흡', '품질 기준 미달', '독립 수행 불가'],
    followup: ['책임 범위와 산출물 품질을 점검할 필요가 있습니다.', '역량 강화를 위한 구체적 지원이 필요합니다.', '다음 기간에는 명확한 목표 설정을 권장합니다.', '관리자와의 긴밀한 소통을 통해 개선 방안을 마련해 주시기 바랍니다.'],
  },
};

const TASK_KEYWORDS = [
  '보고서', '분석', '기획', '운영', '관리', '개선', '검토', '지원', '정비', '수립',
  '조율', '협업', '실행', '완수', '추진', '점검', '평가', '설계', '구축', '최적화',
  '제안', '처리', '모니터링', '정리', '배분', '취합', '검증', '산출', '기록', '공유',
];

const CONNECTORS = ['또한', '아울러', '특히', '이에', '결과적으로', '전반적으로'];

function getGapBucket(score, growthLevel) {
  const gap = Math.round(score) - Math.round(growthLevel);
  if (gap >= 1) return 'exceed';
  if (gap === 0) return 'meet';
  if (gap === -1) return 'near';
  return 'below';
}

// glyph spam 패턴 (detectMeaninglessContent 실히트: 연속 자음 5개 이상)
const GLYPH_PATTERNS = [
  'ㄴㄴㅇㅇㅇ',
  'ㅋㅋㅋㅋㅋ',
  'ㅎㅎㅎㅎㅎ',
  'ㅇㅋㅇㅋㅇ',
  'ㄴㄴㄴㄴㄴ',
  'ㅇㅇㅇㅇㅇ',
  'ㅂㅂㅂㅂㅂ',
  'ㅋㅋㅎㅎㅎ',
  'ㄴㄴㄴㅇㅇ',
  'ㅎㅎㅋㅋㅋ',
  'ㅇㅇㅎㅎㅎ',
  'ㅋㅋㅋㅎㅎ',
  'ㄴㄴㄴㄴㅇ',
];

// 명사종결 형식미달 패턴 (SentenceCount 실패: 종결어미/마침표 없음)
const NOUN_ENDINGS = [
  '계획 보완 요망',
  '역할 범위 재검토',
  '역량 강화 필요',
  '성과 미흡',
  '기여 제한적',
  '품질 점검 요구',
  '일정 미준수',
  '독립 수행 미흡',
  '보완 사항 존재',
  '추가 지원 필요',
];

function generateFeedback(rng, score, growthLevel, taskTitle, evalId, evaluatorId) {
  // 길이 카테고리 결정
  // 70% 45~160자 / 15% 30~50자 / 8% 10~29자(형식미달) / 4% 복붙 / 1% glyph
  // rng는 이미 해당 과업·평가자에 고유한 시드를 가짐
  const r = rng();

  if (r < 0.01) {
    // 1% glyph spam
    const idx = Math.floor(rng() * GLYPH_PATTERNS.length);
    return GLYPH_PATTERNS[idx];
  }

  if (r < 0.05) {
    // 4% 복붙 — 평가자 고정 문구 (evaluatorId 기반)
    const rngCopy = makePrng(evaluatorId, 'copyPaste');
    const bucket = getGapBucket(score, growthLevel);
    const v = FEEDBACK_VOCAB[bucket];
    const opener = v.openers[Math.floor(rngCopy() * v.openers.length)];
    const action = v.actions[Math.floor(rngCopy() * v.actions.length)];
    const followup = v.followup[Math.floor(rngCopy() * v.followup.length)];
    return `${opener} ${action}. ${followup}`;
  }

  if (r < 0.13) {
    // 8% 형식미달(10~29자) — 절반은 명사종결, 절반은 짧은 단문
    const r2 = rng();
    if (r2 < 0.5) {
      // 명사종결 (SentenceCount 실패)
      const idx = Math.floor(rng() * NOUN_ENDINGS.length);
      return NOUN_ENDINGS[idx];
    } else {
      // 짧은 단문
      const bucket = getGapBucket(score, growthLevel);
      const v = FEEDBACK_VOCAB[bucket];
      const q = v.qualifiers[Math.floor(rng() * v.qualifiers.length)];
      const action = v.actions[Math.floor(rng() * v.actions.length)];
      return `${q}, ${action}`;
    }
  }

  if (r < 0.28) {
    // 15% 중간 길이 일반론 (30~50자)
    const bucket = getGapBucket(score, growthLevel);
    const v = FEEDBACK_VOCAB[bucket];
    const opener = v.openers[Math.floor(rng() * v.openers.length)];
    const action = v.actions[Math.floor(rng() * v.actions.length)];
    const followup = v.followup[Math.floor(rng() * v.followup.length)];
    return `${opener} ${action}. ${followup}`;
  }

  // 70% 구체적 피드백 (45~160자)
  const bucket = getGapBucket(score, growthLevel);

  // 6% 의도적 불일치 (점수-의견 mismatch)
  const mismatch = rng() < 0.06;
  const actualBucket = mismatch
    ? (['exceed', 'meet', 'near', 'below'].filter(b => b !== bucket)[Math.floor(rng() * 3)])
    : bucket;

  const v = FEEDBACK_VOCAB[actualBucket];

  // 과업 키워드 추출 (title에서 일치하는 것, 없으면 랜덤)
  const kw = TASK_KEYWORDS.find(k => taskTitle && taskTitle.includes(k))
    || TASK_KEYWORDS[Math.floor(rng() * TASK_KEYWORDS.length)];

  const opener = v.openers[Math.floor(rng() * v.openers.length)];
  const adv = v.adv[Math.floor(rng() * v.adv.length)];
  const action = v.actions[Math.floor(rng() * v.actions.length)];
  const q = v.qualifiers[Math.floor(rng() * v.qualifiers.length)];
  const connector = CONNECTORS[Math.floor(rng() * CONNECTORS.length)];
  const followup = v.followup[Math.floor(rng() * v.followup.length)];

  // 2~4문장 조합으로 unique 문자열 생성
  const nSentences = 2 + Math.floor(rng() * 3);
  const parts = [
    `${kw} 관련 ${opener} ${adv} ${action}.`,
    `${connector} ${q}이(가) 확인되었습니다.`,
    `${followup}`,
    `구체적인 성과로 ${adv} ${action}.`,
  ];
  return parts.slice(0, nSentences).join(' ');
}

// ─────────────────────────────────────────────
// 날짜 유틸
// ─────────────────────────────────────────────
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function toISOTimestamp(dateStr) {
  return new Date(dateStr + 'T00:00:00.000Z').toISOString();
}

// feedback created_at: end_date 직후 7~56일, 단 12월 종료 과업은 당해 12월 클램프
function feedbackCreatedAt(rng, endDate) {
  const offsetDays = randInt(rng, 7, 56);
  const candidate = addDays(endDate, offsetDays);
  const endYear = parseInt(endDate.slice(0, 4), 10);
  const candidateYear = parseInt(candidate.slice(0, 4), 10);

  if (candidateYear > endYear) {
    // 익년으로 넘어가면 당해 12월 31일로 클램프
    return toISOTimestamp(`${endYear}-12-31`);
  }
  return toISOTimestamp(candidate);
}

// changed_at staggered 생성
function changedAt2025(rng) {
  const day = randInt(rng, 29, 31);
  return `2024-12-${String(day).padStart(2, '0')}T${String(randInt(rng, 0, 23)).padStart(2, '0')}:${String(randInt(rng, 0, 59)).padStart(2, '0')}:00.000Z`;
}

function changedAt2026First(rng) {
  const day = randInt(rng, 1, 3);
  return `2026-01-${String(day).padStart(2, '0')}T${String(randInt(rng, 8, 18)).padStart(2, '0')}:00:00.000Z`;
}

function changedAt2026Transfer(rng) {
  const month = randInt(rng, 2, 5);
  const day = randInt(rng, 1, 28);
  return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(randInt(rng, 8, 18)).padStart(2, '0')}:00:00.000Z`;
}

// ─────────────────────────────────────────────
// UUID v4 생성 (crypto.randomUUID 없는 Node 버전 대비)
// ─────────────────────────────────────────────
function genUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // 폴백: 결정적이 아닌 랜덤 (INSERT 타이밍에만 사용)
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return [h.slice(0,8), h.slice(8,12), h.slice(12,16), h.slice(16,20), h.slice(20)].join('-');
}

// ─────────────────────────────────────────────
// 과업 제목 생성
// ─────────────────────────────────────────────
const TASK_TITLES = [
  '월간 성과 보고서 작성', '분기 실적 분석', '팀 운영 계획 수립', '업무 프로세스 개선',
  '신규 제도 기획', '내부 감사 지원', '예산 집행 관리', '조직문화 개선 프로젝트',
  '인사 데이터 정비', '채용 프로세스 운영', '교육 프로그램 기획', '성과평가 운영 지원',
  '시스템 고도화 기획', '업무 매뉴얼 정비', '외부 협력 조율', '리스크 관리 체계 구축',
  '보고체계 표준화', '팀 KPI 점검', '직원 설문 분석', '비용 절감 방안 수립',
  'HR 데이터 분석', '연간 사업계획 지원', '부서 간 협업 조율', '프로세스 자동화 검토',
  '운영 효율화 과제', '전사 공통 기준 수립', '임원 보고자료 작성', '정책 개선 제안',
  '워크숍 기획 및 운영', '성과지표 개발', '직무분석 프로젝트', '조직개편 지원',
  '인재육성 계획 수립', '복리후생 제도 개선', '근태 관리 체계 점검', '노사관계 지원',
  '글로벌 인사제도 검토', '디지털 전환 기획', '컴플라이언스 점검', '전략기획 지원',
];

function randomTaskTitle(rng) {
  return TASK_TITLES[Math.floor(rng() * TASK_TITLES.length)];
}

// ─────────────────────────────────────────────
// 과업 날짜 생성 (평가연도 기준)
// ─────────────────────────────────────────────
function generateTaskDates(rng, year) {
  const startMonth = randInt(rng, 1, 10);
  const endMonth = randInt(rng, startMonth, Math.min(startMonth + 3, 12));
  const startDay = randInt(rng, 1, 15);
  const endDay = randInt(rng, 15, 28);
  const startDate = `${year}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
  const endDate = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

// ─────────────────────────────────────────────
// 승급 판단 (상위 12% → L→L+1)
// ─────────────────────────────────────────────
function isPromotion(employeeId, ability2025) {
  const rng = makePrng(employeeId, 'promotion');
  // ability 상위 12% (ability2025 > 약 1.18 at 88th percentile)
  // 단순하게 능력+운(rng)로 판단
  return ability2025 > 1.0 && rng() < 0.55;
}

// ─────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────
(async () => {
  const pool = new Pool({ connectionString: CONN });
  const c = await pool.connect();

  try {
    await c.query('BEGIN');

    console.log(`\n=== ${RECONSTRUCT_TAG} 샘플데이터 재구성 시작 ===`);
    console.log(`DRY_RUN=${DRY_RUN} (RECONSTRUCT_COMMIT=${process.env.RECONSTRUCT_COMMIT || '미설정'})`);

    // ── 1. 마스터 데이터 로드 (읽기 전용) ──────────────────────────────
    console.log('\n[1] 마스터 데이터 로드 중...');

    const employees = (await c.query(
      'SELECT id, employee_id, name, position, department, growth_level, evaluator_id FROM employees ORDER BY employee_id'
    )).rows;
    console.log(`  employees: ${employees.length}명`);

    const empById = new Map(employees.map(e => [e.employee_id, e]));

    // 평가기간 확인
    const periods = (await c.query(
      'SELECT id, code, evaluation_year FROM evaluation_periods WHERE id IN ($1, $2)',
      [PERIOD_2025, PERIOD_2026]
    )).rows;
    if (periods.length !== 2) throw new Error(`evaluation_periods 2건 필요, 현재 ${periods.length}건`);
    console.log(`  evaluation_periods: ${periods.map(p => p.code).join(', ')}`);

    // 기존 evaluations 로드 (evaluatee_id, evaluation_year, id, record_status, growth_level)
    const existingEvals = (await c.query(
      "SELECT id, evaluatee_id, evaluation_year, evaluation_period_id, record_status, growth_level FROM evaluations WHERE evaluation_year IN (2025, 2026) ORDER BY evaluatee_id, evaluation_year, id"
    )).rows;
    console.log(`  기존 evaluations: ${existingEvals.length}건`);

    // ── 2. ability_z 계산 ──────────────────────────────────────────────
    console.log('\n[2] 피평가자 잠재 실력 계산 중...');

    const ability2025Map = new Map(); // employee_id → ability
    const ability2026Map = new Map();
    for (const emp of employees) {
      const gl = emp.growth_level || 2;
      const a2025 = getAbility2025(emp.employee_id, gl);
      const a2026 = getAbility2026(emp.employee_id, a2025);
      ability2025Map.set(emp.employee_id, a2025);
      ability2026Map.set(emp.employee_id, a2026);
    }

    // ── 3. 평가자 코호트·파라미터 준비 ────────────────────────────────
    console.log('\n[3] 평가자 코호트 파라미터 준비 중...');

    // 평가자 목록: employees 중 evaluator_id 역할을 하는 사람들
    const evaluatorIds = new Set(employees.map(e => e.evaluator_id).filter(Boolean));
    const evaluatorParams = new Map();
    for (const evId of evaluatorIds) {
      evaluatorParams.set(evId, getEvaluatorParams(evId));
    }
    console.log(`  평가자: ${evaluatorIds.size}명`);

    // ── 4. 전보 코호트 설계 ────────────────────────────────────────────
    console.log('\n[4] 전보 코호트 설계 중...');

    // 피평가자 목록 (2025·2026 모두 포함)
    const evaluatees2025 = [...new Set(
      existingEvals.filter(e => e.evaluation_year === 2025).map(e => e.evaluatee_id)
    )];
    const evaluatees2026 = [...new Set(
      existingEvals.filter(e => e.evaluation_year === 2026).map(e => e.evaluatee_id)
    )];
    const allEvaluatees = [...new Set([...evaluatees2025, ...evaluatees2026])];
    console.log(`  2025 피평가자: ${evaluatees2025.length}명, 2026: ${evaluatees2026.length}명`);

    // 2026 duplicate evaluatees (기간내 전보) — 현 데이터의 59건 정합
    const eval2026CountByEvaluatee = new Map();
    for (const ev of existingEvals.filter(e => e.evaluation_year === 2026)) {
      eval2026CountByEvaluatee.set(ev.evaluatee_id, (eval2026CountByEvaluatee.get(ev.evaluatee_id) || 0) + 1);
    }
    const inPeriodTransferEvaluatees = [...eval2026CountByEvaluatee.entries()]
      .filter(([, cnt]) => cnt > 1)
      .map(([id]) => id);
    console.log(`  기간내 전보(duplicate): ${inPeriodTransferEvaluatees.length}명`);

    // 기간간 전보: 2025→2026 평가자 변경 12% (~83명)
    const interPeriodTransferCount = Math.round(evaluatees2025.length * 0.12);
    const interPeriodTransferSet = new Set();
    {
      const rng = mulberry32(sha256seed('inter_period_transfer_selection'));
      const shuffled = [...evaluatees2025].sort(() => rng() - 0.5);
      for (let i = 0; i < interPeriodTransferCount && i < shuffled.length; i++) {
        interPeriodTransferSet.add(shuffled[i]);
      }
    }
    console.log(`  기간간 전보: ${interPeriodTransferSet.size}명`);

    // 전보 양극단 배정: ~30%는 LENIENT↔STRICT 극단 평가자 간 이동
    // (assignment_history 생성 시 반영)

    // ── 5. 기존 데이터 삭제 (FK 역순) ─────────────────────────────────
    console.log('\n[5] 기존 2025·2026 데이터 삭제 중 (FK 역순)...');

    const evalIds = existingEvals.map(e => e.id);
    if (evalIds.length === 0) {
      console.log('  삭제할 evaluation 없음 (신규 데이터 생성)');
    } else {
      // 1) feedback_history (evaluation_id → evaluations)
      const fhDel = await c.query(
        'DELETE FROM feedback_history WHERE evaluation_id = ANY($1::uuid[])',
        [evalIds]
      );
      console.log(`  feedback_history 삭제: ${fhDel.rowCount}건`);

      // 2) task_evaluation_entries (evaluation_id → evaluations, CASCADE이나 명시적 삭제)
      const teeDel = await c.query(
        'DELETE FROM task_evaluation_entries WHERE evaluation_id = ANY($1::uuid[])',
        [evalIds]
      );
      console.log(`  task_evaluation_entries 삭제: ${teeDel.rowCount}건`);

      // 3) tasks (evaluation_id → evaluations, CASCADE)
      const tasksDel = await c.query(
        'DELETE FROM tasks WHERE evaluation_id = ANY($1::uuid[])',
        [evalIds]
      );
      console.log(`  tasks 삭제: ${tasksDel.rowCount}건`);

      // 4) evaluations.assignment_history_id를 NULL로 초기화 (순환 FK 해제)
      await c.query(
        'UPDATE evaluations SET assignment_history_id = NULL WHERE id = ANY($1::uuid[])',
        [evalIds]
      );

      // 5) evaluator_assignment_history (evaluation_id → evaluations)
      const ahDel = await c.query(
        'DELETE FROM evaluator_assignment_history WHERE evaluation_id = ANY($1::uuid[])',
        [evalIds]
      );
      // 기간 기준으로도 삭제 (evaluation_id 없는 행 포함)
      const ahDel2 = await c.query(
        'DELETE FROM evaluator_assignment_history WHERE evaluation_period_id = ANY($1::uuid[])',
        [[PERIOD_2025, PERIOD_2026]]
      );
      console.log(`  evaluator_assignment_history 삭제: ${ahDel.rowCount + ahDel2.rowCount}건`);

      // 6) evaluations 행은 구조(id, evaluatee_id, period 링크) 보존, 내용만 갱신
      // evaluation_status·growth_level·assignment_history_id 갱신 예정
      console.log(`  evaluations 행 구조 보존 (${evalIds.length}건)`);
    }

    // ── 6. 데이터 생성 ────────────────────────────────────────────────
    console.log('\n[6] 데이터 생성 중...');

    // evaluations를 (evaluatee_id, evaluation_year) → [eval rows] 로 인덱스
    const evalsByEvaluatee = new Map();
    for (const ev of existingEvals) {
      const key = `${ev.evaluatee_id}:${ev.evaluation_year}`;
      if (!evalsByEvaluatee.has(key)) evalsByEvaluatee.set(key, []);
      evalsByEvaluatee.get(key).push(ev);
    }

    // 생성될 데이터 배열
    const newTasks = [];
    const newTaskEntries = [];
    const newFeedbackHistory = [];
    const newAssignmentHistory = []; // {id, employee_id, previous_evaluator_id, new_evaluator_id, evaluation_period_id, changed_at, changed_by, change_type, status, reason, supersedes_history_id, evaluation_id_link}
    const evalUpdates = []; // {evalId, growth_level, evaluation_status, assignment_history_id}

    // 정정(supersede) 6건용 히스토리 — 재생성 시 일부에 적용
    const correctionTargets = new Set();
    {
      const rng = mulberry32(sha256seed('correction_targets'));
      const shuffled = [...allEvaluatees].sort(() => rng() - 0.5);
      for (let i = 0; i < 5 && i < shuffled.length; i++) correctionTargets.add(shuffled[i]);
    }

    // NULL new_evaluator 잔존 3건 (cancel 누락 케이스)
    const nullEvaluatorTargets = new Set();
    {
      const rng = mulberry32(sha256seed('null_evaluator_targets'));
      const shuffled = [...allEvaluatees].sort(() => rng() - 0.5);
      for (let i = 0; i < 3 && i < shuffled.length; i++) nullEvaluatorTargets.add(shuffled[i]);
    }

    // in-progress 대상: 1.5% (~21건)
    const inProgressTargets = new Set();
    {
      const rng = mulberry32(sha256seed('in_progress_targets'));
      const shuffled = [...allEvaluatees].sort(() => rng() - 0.5);
      for (let i = 0; i < Math.round(allEvaluatees.length * 0.015) && i < shuffled.length; i++) {
        inProgressTargets.add(shuffled[i]);
      }
    }

    // feedback NULL 과업 3% (~128건) — evaluation_id 기반 결정적
    function isFeedbackNull(evalId, taskIdx) {
      const h = sha256seed(evalId + ':feedback_null:' + taskIdx);
      return (h % 33) === 0; // 약 3% (1/33)
    }

    // 연도별 growth_level 목표 분포 재현
    // 2025: L1 9/L2 24/L3 47/L4 20 (%)
    // 2026: L1 8/L2 23/L3 47/L4 22 (%)
    // employees.growth_level 기반이므로 evaluations growth_level에 승급 반영
    function getEvalGrowthLevel(employeeId, year) {
      const emp = empById.get(employeeId);
      if (!emp) return 2;
      const baseGl = emp.growth_level || 2;
      if (year === 2026 && isPromotion(employeeId, ability2025Map.get(employeeId) || 0)) {
        return Math.min(4, baseGl + 1);
      }
      return baseGl;
    }

    // 평가자 배정 로직
    // 각 피평가자의 2025 담당 평가자: employees.evaluator_id 기반
    // 기간간 전보: 2026에 다른 평가자 배정
    function getEvaluatorFor(employeeId, year, isTransfer) {
      const emp = empById.get(employeeId);
      const baseEvaluator = emp?.evaluator_id || null;

      if (year === 2025 || !isTransfer) return baseEvaluator;

      // 2026 전보: 다른 평가자로 교체
      // 양극단 30%는 LENIENT↔STRICT
      const rng = makePrng(employeeId, 'transfer_evaluator');
      const isExtreme = rng() < 0.30;

      if (isExtreme && baseEvaluator) {
        const currentParams = evaluatorParams.get(baseEvaluator);
        const currentCohort = currentParams?.cohort || 'DISCRIMINATING';
        // 반대 극단 찾기
        const targetCohort = (currentCohort === 'LENIENT_FLAT') ? 'STRICT_FLAT'
          : (currentCohort === 'STRICT_FLAT') ? 'LENIENT_FLAT'
          : 'DISCRIMINATING';
        const candidates = [...evaluatorIds].filter(id => {
          const p = evaluatorParams.get(id);
          return p && p.cohort === targetCohort && id !== baseEvaluator;
        });
        if (candidates.length > 0) {
          return candidates[Math.floor(rng() * candidates.length)];
        }
      }

      // 일반 전보: 랜덤 교체
      const candidates = [...evaluatorIds].filter(id => id !== baseEvaluator);
      if (candidates.length === 0) return baseEvaluator;
      return candidates[Math.floor(rng() * candidates.length)];
    }

    let totalTasksCreated = 0;
    let totalEntriesCreated = 0;
    let totalFeedbackCreated = 0;
    let weightDefectCount = 0;
    let inProgressCount = 0;
    // score=0 하드픽 단일 과업 (재현용)
    let scoreZeroInjected = false;
    const scoreZeroTaskEvalId = existingEvals.find(e => e.evaluation_year === 2025)?.id;

    // assignment_history 배열 (나중에 평가 ID 연결)
    // key: employee_id + ':' + periodId → ahId
    const ahIdMap = new Map();

    // 2-pass: 먼저 assignment_history 생성 (evaluation_id는 나중에 UPDATE)
    console.log('  2-pass: assignment_history 먼저 생성...');

    for (const employeeId of allEvaluatees) {
      const emp = empById.get(employeeId);
      if (!emp) continue;

      const isInterTransfer = interPeriodTransferSet.has(employeeId);
      const isIntraTransfer = inPeriodTransferEvaluatees.includes(employeeId);
      const isCorrectionTarget = correctionTargets.has(employeeId);
      const isNullEvaluator = nullEvaluatorTargets.has(employeeId);

      const rngTs2025 = makePrng(employeeId, 'ah_ts_2025');
      const rngTs2026 = makePrng(employeeId, 'ah_ts_2026');

      const ev2025 = emp.evaluator_id || null;
      const ev2026 = isInterTransfer ? getEvaluatorFor(employeeId, 2026, true) : ev2025;

      // 2025 기간 행
      const ah2025Id = genUUID();
      ahIdMap.set(`${employeeId}:${PERIOD_2025}`, ah2025Id);
      newAssignmentHistory.push({
        id: ah2025Id,
        employee_id: employeeId,
        previous_evaluator_id: null,
        new_evaluator_id: isNullEvaluator ? null : ev2025,
        evaluation_period_id: PERIOD_2025,
        changed_at: changedAt2025(rngTs2025),
        changed_by: RECONSTRUCT_TAG,
        change_type: isNullEvaluator ? 'cancel' : 'change',
        status: 'applied',
        reason: `${RECONSTRUCT_TAG} 2025 period-scoped seed`,
        supersedes_history_id: null,
        evaluation_id_link: null, // 나중에 채움
      });

      // 2026 기간 행 (첫 번째)
      const ah2026Id = genUUID();
      ahIdMap.set(`${employeeId}:${PERIOD_2026}`, ah2026Id);
      newAssignmentHistory.push({
        id: ah2026Id,
        employee_id: employeeId,
        previous_evaluator_id: ev2025,
        new_evaluator_id: ev2026,
        evaluation_period_id: PERIOD_2026,
        changed_at: changedAt2026First(rngTs2026),
        changed_by: RECONSTRUCT_TAG,
        change_type: 'change',
        status: 'applied',
        reason: `${RECONSTRUCT_TAG} 2026 period start`,
        supersedes_history_id: null,
        evaluation_id_link: null,
      });

      // 기간내 전보: 두 번째 행 (2026 연중)
      if (isIntraTransfer) {
        const rngIntra = makePrng(employeeId, 'ah_intra_2026');
        const ev2026b = getEvaluatorFor(employeeId, 2026, true);
        const ah2026bId = genUUID();
        ahIdMap.set(`${employeeId}:${PERIOD_2026}:intra`, ah2026bId);
        newAssignmentHistory.push({
          id: ah2026bId,
          employee_id: employeeId,
          previous_evaluator_id: ev2026,
          new_evaluator_id: ev2026b,
          evaluation_period_id: PERIOD_2026,
          changed_at: changedAt2026Transfer(rngIntra),
          changed_by: RECONSTRUCT_TAG,
          change_type: 'change',
          status: 'applied',
          reason: `${RECONSTRUCT_TAG} 2026 intra-period transfer`,
          supersedes_history_id: null,
          evaluation_id_link: null,
        });
      }

      // 정정(supersede) 케이스: 원본 행 + 정정 행
      if (isCorrectionTarget) {
        const rngCorr = makePrng(employeeId, 'correction');
        const originalId = ah2026Id;
        const corrId = genUUID();
        // 정정 행의 supersedes_history_id = 원본 행 ID
        // (마지막에 원본 행의 status를 'cancelled'로 변경하려면 추가 UPDATE 필요 — 간소화: 정정 행에 supersedes 링크만)
        newAssignmentHistory.push({
          id: corrId,
          employee_id: employeeId,
          previous_evaluator_id: ev2026,
          new_evaluator_id: getEvaluatorFor(employeeId, 2026, true),
          evaluation_period_id: PERIOD_2026,
          changed_at: changedAt2026Transfer(rngCorr),
          changed_by: `${RECONSTRUCT_TAG}-correction`,
          change_type: 'change',
          status: 'applied',
          reason: `${RECONSTRUCT_TAG} 정정(correction)`,
          supersedes_history_id: originalId,
          evaluation_id_link: null,
        });
      }
    }

    // 과업·피드백 생성 (evaluation 단위)
    console.log('  과업·entry·피드백 생성...');

    for (const ev of existingEvals) {
      const employeeId = ev.evaluatee_id;
      const year = ev.evaluation_year;
      const evalId = ev.id;

      const emp = empById.get(employeeId);
      if (!emp) continue;

      const growthLevel = getEvalGrowthLevel(employeeId, year);
      const abilityZ = year === 2025
        ? (ability2025Map.get(employeeId) || 0)
        : (ability2026Map.get(employeeId) || 0);

      // 평가자 파라미터
      // 기간내 전보의 경우 두 번째 evaluation은 두 번째 평가자
      const isIntraTransfer = inPeriodTransferEvaluatees.includes(employeeId);
      const eval2026ForEmp = evalsByEvaluatee.get(`${employeeId}:2026`) || [];
      const isSecondEvalOf2026 = year === 2026 && eval2026ForEmp.length > 1
        && eval2026ForEmp[1]?.id === evalId;

      let evaluatorId;
      if (year === 2025) {
        evaluatorId = emp.evaluator_id;
      } else if (isSecondEvalOf2026 && isIntraTransfer) {
        // 두 번째 2026 평가: 전보 후 새 평가자
        evaluatorId = getEvaluatorFor(employeeId, 2026, true);
      } else {
        evaluatorId = interPeriodTransferSet.has(employeeId)
          ? getEvaluatorFor(employeeId, 2026, true)
          : emp.evaluator_id;
      }

      const evParams = evaluatorId ? evaluatorParams.get(evaluatorId) : null;
      const bias_e = evParams?.bias_e || 0;
      const sigma_e = evParams?.sigma_e || 0.6;
      const cohort = evParams?.cohort || 'DISCRIMINATING';

      // 과업 수 (2:15%, 3:45%, 4:30%, 5:10%)
      const rngTaskCount = makePrng(evalId, 'task_count');
      const taskCountR = rngTaskCount();
      const taskCount = taskCountR < 0.15 ? 2 : taskCountR < 0.60 ? 3 : taskCountR < 0.90 ? 4 : 5;

      // 가중치 생성
      const rngWeight = makePrng(evalId, 'weights');
      let weights = generateWeights(rngWeight, taskCount);

      // 의도 결함 주입
      const isDefect = isWeightDefectEval(evalId);
      if (isDefect) {
        weights = applyWeightDefect(makePrng(evalId, 'weight_defect'), weights);
        weightDefectCount++;
      }

      // in-progress 판단
      const isInProgress = inProgressTargets.has(employeeId);
      if (isInProgress) inProgressCount++;

      let allScored = true;

      const taskUuids = [];

      for (let ti = 0; ti < taskCount; ti++) {
        const rngTask = makePrng(evalId + ':' + ti, 'task');
        const rngScore = makePrng(evalId + ':' + ti, 'score');
        const rngCell = makePrng(evalId + ':' + ti + ':' + (evaluatorId || ''), 'cellPick');
        const rngFb = makePrng(evalId + ':' + ti + ':' + (evaluatorId || ''), 'feedbackPick');

        const { startDate, endDate } = generateTaskDates(rngTask, year);
        const taskTitle = randomTaskTitle(rngTask);
        const weight = weights[ti];

        // score NULL (in-progress) — 마지막 과업에만 적용
        const isNullScore = isInProgress && ti === taskCount - 1;
        if (isNullScore) allScored = false;

        let score = null;
        let methodLabel = null;
        let scopeLabel = null;

        if (!isNullScore) {
          // score=0 하드픽 (단일 건, 재현)
          if (!scoreZeroInjected && evalId === scoreZeroTaskEvalId && ti === 0) {
            score = 0;
            methodLabel = '기여없음';
            scopeLabel = '기여없음';
            scoreZeroInjected = true;
          } else {
            const targetScore = generateScore(rngScore, growthLevel, abilityZ, bias_e, sigma_e);
            const [mIdx, sIdx] = pickCell(rngCell, targetScore, cohort);
            score = getMatrixScore(mIdx, sIdx);
            methodLabel = METHODS[mIdx];
            scopeLabel = SCOPES[sIdx];
          }
        }

        // feedback
        let feedback = null;
        let feedbackDate = null;
        // 0점(기여없음×기여없음) 과업은 의견 없음 — 충족형 의견이 붙어 점수-의견 정합이 깨지지 않게.
        if (score !== null && score > 0 && !isFeedbackNull(evalId, ti)) {
          const rngFbDate = makePrng(evalId + ':' + ti, 'fbDate');
          feedbackDate = feedbackCreatedAt(rngFbDate, endDate);
          feedback = generateFeedback(rngFb, score, growthLevel, taskTitle, evalId, evaluatorId || '');
        }

        const taskId = `GEN${String(year).slice(2)}-${evalId}-${ti}`;
        const taskUuid = genUUID();
        taskUuids.push(taskUuid);

        newTasks.push({
          id: taskUuid,
          task_id: taskId,
          evaluation_id: evalId,
          title: taskTitle,
          weight,
          description: `${RECONSTRUCT_TAG} 재구성 과업 ${ti + 1}`,
          start_date: startDate,
          end_date: endDate,
          contribution_method: methodLabel,
          contribution_scope: scopeLabel,
          score,
          feedback,
          feedback_date: feedbackDate,
          evaluator_name: emp ? (empById.get(evaluatorId || '')?.name || null) : null,
          evaluation_year: year,
          evaluation_period_id: ev.evaluation_period_id,
        });

        // task_evaluation_entry
        if (score !== null && evaluatorId) {
          newTaskEntries.push({
            id: genUUID(),
            task_uuid: taskUuid,
            task_id: taskId,
            evaluation_id: evalId,
            evaluator_id: evaluatorId,
            evaluator_name: empById.get(evaluatorId)?.name || null,
            contribution_method: methodLabel,
            contribution_scope: scopeLabel,
            score,
            feedback,
            feedback_date: feedbackDate,
            assignment_history_id: null, // 나중에 링크
            status: 'active',
          });
          totalEntriesCreated++;
        }

        // feedback_history
        if (feedback && feedbackDate) {
          newFeedbackHistory.push({
            id: genUUID(),
            task_id: taskId,
            content: feedback,
            evaluator_name: empById.get(evaluatorId || '')?.name || null,
            evaluator_id: evaluatorId || null,
            task_uuid: taskUuid,
            evaluation_id: evalId,
            task_evaluation_entry_id: null, // 나중에 연결 가능하나 간소화
            status: 'active',
            created_at: feedbackDate,
          });
          totalFeedbackCreated++;
        }

        totalTasksCreated++;
      }

      // evaluation 상태 업데이트
      const newStatus = allScored ? 'completed' : 'in-progress';
      const periodId = ev.evaluation_period_id;
      const ahKey = isSecondEvalOf2026 && isIntraTransfer
        ? `${employeeId}:${PERIOD_2026}:intra`
        : `${employeeId}:${periodId}`;
      const ahId = ahIdMap.get(ahKey) || ahIdMap.get(`${employeeId}:${periodId}`) || null;

      evalUpdates.push({
        evalId,
        growth_level: growthLevel,
        evaluation_status: newStatus,
        assignment_history_id: ahId,
      });

      // assignment_history evaluation_id_link 연결
      if (ahId) {
        const ah = newAssignmentHistory.find(a => a.id === ahId);
        if (ah && !ah.evaluation_id_link) ah.evaluation_id_link = evalId;
      }
    }

    console.log(`  생성: tasks=${totalTasksCreated}, entries=${totalEntriesCreated}, feedback=${totalFeedbackCreated}`);
    console.log(`  가중치 결함: ${weightDefectCount}건, in-progress: ${inProgressCount}건`);

    // ── 7. INSERT (2-pass) ─────────────────────────────────────────────
    console.log('\n[7] INSERT 중...');

    // 7-a. assignment_history INSERT (evaluation_id는 NULL)
    console.log(`  assignment_history INSERT: ${newAssignmentHistory.length}건`);
    for (const ah of newAssignmentHistory) {
      await c.query(
        `INSERT INTO evaluator_assignment_history
           (id, employee_id, previous_evaluator_id, new_evaluator_id, evaluation_period_id,
            changed_at, changed_by, change_type, status, reason, supersedes_history_id, evaluation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL)`,
        [
          ah.id, ah.employee_id, ah.previous_evaluator_id, ah.new_evaluator_id,
          ah.evaluation_period_id, ah.changed_at, ah.changed_by, ah.change_type,
          ah.status, ah.reason, ah.supersedes_history_id,
        ]
      );
    }

    // 7-b. tasks INSERT
    console.log(`  tasks INSERT: ${newTasks.length}건`);
    for (const t of newTasks) {
      await c.query(
        `INSERT INTO tasks
           (id, task_id, evaluation_id, title, weight, description, start_date, end_date,
            contribution_method, contribution_scope, score, feedback, feedback_date,
            evaluator_name, evaluation_year, evaluation_period_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())`,
        [
          t.id, t.task_id, t.evaluation_id, t.title, t.weight, t.description,
          t.start_date, t.end_date, t.contribution_method, t.contribution_scope,
          t.score, t.feedback, t.feedback_date, t.evaluator_name,
          t.evaluation_year, t.evaluation_period_id,
        ]
      );
    }

    // 7-c. task_evaluation_entries INSERT
    console.log(`  task_evaluation_entries INSERT: ${newTaskEntries.length}건`);
    for (const te of newTaskEntries) {
      await c.query(
        `INSERT INTO task_evaluation_entries
           (id, task_uuid, task_id, evaluation_id, evaluator_id, evaluator_name,
            contribution_method, contribution_scope, score, feedback, feedback_date,
            status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())`,
        [
          te.id, te.task_uuid, te.task_id, te.evaluation_id, te.evaluator_id,
          te.evaluator_name, te.contribution_method, te.contribution_scope,
          te.score, te.feedback, te.feedback_date, te.status,
        ]
      );
    }

    // 7-d. feedback_history INSERT
    console.log(`  feedback_history INSERT: ${newFeedbackHistory.length}건`);
    for (const fh of newFeedbackHistory) {
      await c.query(
        `INSERT INTO feedback_history
           (id, task_id, content, evaluator_name, evaluator_id, task_uuid, evaluation_id,
            task_evaluation_entry_id, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          fh.id, fh.task_id, fh.content, fh.evaluator_name, fh.evaluator_id, fh.task_uuid,
          fh.evaluation_id, fh.task_evaluation_entry_id, fh.status, fh.created_at,
        ]
      );
    }

    // 7-e. evaluations UPDATE (assignment_history_id, growth_level, evaluation_status)
    console.log(`  evaluations UPDATE: ${evalUpdates.length}건`);
    for (const eu of evalUpdates) {
      await c.query(
        `UPDATE evaluations
         SET assignment_history_id=$1, growth_level=$2, evaluation_status=$3, updated_at=NOW()
         WHERE id=$4`,
        [eu.assignment_history_id, eu.growth_level, eu.evaluation_status, eu.evalId]
      );
    }

    // 7-f. assignment_history.evaluation_id UPDATE
    console.log('  assignment_history evaluation_id 링크 업데이트...');
    let ahLinked = 0;
    for (const ah of newAssignmentHistory) {
      if (ah.evaluation_id_link) {
        await c.query(
          'UPDATE evaluator_assignment_history SET evaluation_id=$1 WHERE id=$2',
          [ah.evaluation_id_link, ah.id]
        );
        ahLinked++;
      }
    }
    console.log(`  assignment_history 링크: ${ahLinked}건`);

    // ── 8. 검증 통계 ──────────────────────────────────────────────────
    console.log('\n[8] 검증 통계 수집 중...');

    const stats = {};

    // 점수 분포
    const scoreDist = await c.query(
      `SELECT score, COUNT(*) n FROM tasks WHERE deleted_at IS NULL AND evaluation_period_id = ANY($1::uuid[])
       GROUP BY score ORDER BY score`,
      [[PERIOD_2025, PERIOD_2026]]
    );
    stats.scoreDist = scoreDist.rows.map(r => `score${r.score}=${r.n}`).join(', ');

    // 가중치 결함
    const weightBad = await c.query(
      `SELECT COUNT(*) n FROM (
         SELECT evaluation_id FROM tasks WHERE deleted_at IS NULL AND evaluation_period_id = ANY($1::uuid[])
         GROUP BY evaluation_id HAVING SUM(weight)<>100
       ) x`,
      [[PERIOD_2025, PERIOD_2026]]
    );
    stats.weightBadCount = weightBad.rows[0].n;

    // 갭 분포
    const gapDist = await c.query(
      `SELECT
         CASE WHEN t.score - e.growth_level >= 1 THEN 'exceed'
              WHEN t.score - e.growth_level = 0 THEN 'meet'
              WHEN t.score - e.growth_level = -1 THEN 'near'
              ELSE 'below' END bucket,
         COUNT(*) n
       FROM tasks t
       JOIN evaluations e ON e.id = t.evaluation_id
       WHERE t.deleted_at IS NULL AND t.score > 0
         AND t.evaluation_period_id = ANY($1::uuid[])
       GROUP BY 1 ORDER BY 2 DESC`,
      [[PERIOD_2025, PERIOD_2026]]
    );
    stats.gapDist = gapDist.rows.map(r => `${r.bucket}=${r.n}`).join(', ');

    // 평가자 관대도 분산
    const evalVariance = await c.query(
      `SELECT ROUND(VARIANCE(avg_score)::numeric, 4) var_evaluator_means
       FROM (
         SELECT evaluator_id, AVG(score) avg_score
         FROM task_evaluation_entries
         WHERE status='active' AND score IS NOT NULL
           AND evaluation_id = ANY(
             SELECT id FROM evaluations WHERE evaluation_period_id = ANY($1::uuid[])
           )
         GROUP BY evaluator_id HAVING COUNT(*) >= 3
       ) x`,
      [[PERIOD_2025, PERIOD_2026]]
    );
    stats.evaluatorMeanVariance = evalVariance.rows[0]?.var_evaluator_means;

    // 연도간 ρ (weightedScore)
    const rhoQuery = await c.query(
      `WITH y AS (
         SELECT e.evaluatee_id, e.evaluation_year,
                SUM(t.score::float * t.weight / 100.0) ws
         FROM evaluations e
         JOIN tasks t ON t.evaluation_id = e.id
         WHERE t.deleted_at IS NULL AND t.score IS NOT NULL
           AND e.evaluation_period_id = ANY($1::uuid[])
         GROUP BY e.evaluatee_id, e.evaluation_year
       )
       SELECT ROUND(corr(a.ws, b.ws)::numeric, 4) rho
       FROM y a JOIN y b ON a.evaluatee_id = b.evaluatee_id
       WHERE a.evaluation_year = 2025 AND b.evaluation_year = 2026`,
      [[PERIOD_2025, PERIOD_2026]]
    );
    stats.yearRho = rhoQuery.rows[0]?.rho;

    // 전보 건수
    const transferCount = await c.query(
      `SELECT COUNT(DISTINCT employee_id) n
       FROM (
         SELECT employee_id FROM evaluator_assignment_history
         WHERE status='applied' AND change_type='change'
           AND evaluation_period_id = ANY($1::uuid[])
         GROUP BY employee_id, evaluation_period_id HAVING COUNT(*) > 1
       ) x`,
      [[PERIOD_2025, PERIOD_2026]]
    );
    stats.intraTransferCount = transferCount.rows[0]?.n;

    // 의견 unique율
    const fbUniq = await c.query(
      `SELECT COUNT(*) total, COUNT(DISTINCT content) uniq,
              ROUND(100.0 * COUNT(DISTINCT content) / NULLIF(COUNT(*), 0), 1) uniq_pct
       FROM feedback_history
       WHERE status='active'
         AND evaluation_id = ANY(
           SELECT id FROM evaluations WHERE evaluation_period_id = ANY($1::uuid[])
         )`,
      [[PERIOD_2025, PERIOD_2026]]
    );
    stats.feedbackUniqPct = fbUniq.rows[0]?.uniq_pct;
    stats.feedbackTotal = fbUniq.rows[0]?.total;
    stats.feedbackUniq = fbUniq.rows[0]?.uniq;

    // 무결성 주입 건수
    const integrityCheck = await c.query(
      `SELECT
         (SELECT COUNT(*) FROM feedback_history
          WHERE status='active' AND length(btrim(content)) < 30
            AND evaluation_id = ANY(
              SELECT id FROM evaluations WHERE evaluation_period_id = ANY($1::uuid[])
            )) short_fb,
         (SELECT COUNT(*) FROM tasks
          WHERE deleted_at IS NULL AND score IS NOT NULL
            AND NULLIF(btrim(COALESCE(feedback,'')), '') IS NULL
            AND evaluation_period_id = ANY($1::uuid[])) missing_fb,
         (SELECT COUNT(*) FROM (
           SELECT evaluation_id FROM tasks
           WHERE deleted_at IS NULL AND evaluation_period_id = ANY($1::uuid[])
           GROUP BY evaluation_id HAVING SUM(weight) <> 100
         ) w) weight_bad_check`,
      [[PERIOD_2025, PERIOD_2026]]
    );
    stats.shortFb = integrityCheck.rows[0]?.short_fb;
    stats.missingFb = integrityCheck.rows[0]?.missing_fb;
    stats.weightBadFinal = integrityCheck.rows[0]?.weight_bad_check;

    // 완료/진행중 정합
    const completionCheck = await c.query(
      `SELECT
         CASE WHEN cnt_null = 0 THEN 'complete' ELSE 'in-progress' END st,
         COUNT(*) n
       FROM (
         SELECT t.evaluation_id, COUNT(*) FILTER (WHERE t.score IS NULL) cnt_null
         FROM tasks t
         WHERE t.deleted_at IS NULL
           AND t.evaluation_period_id = ANY($1::uuid[])
         GROUP BY t.evaluation_id
       ) x GROUP BY 1`,
      [[PERIOD_2025, PERIOD_2026]]
    );
    stats.completionDist = completionCheck.rows.map(r => `${r.st}=${r.n}`).join(', ');

    // ── 9. 통계 출력 ──────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════');
    console.log(`검증 통계 (${DRY_RUN ? 'DRY_RUN — ROLLBACK 예정' : 'COMMIT 예정'})`);
    console.log('═══════════════════════════════════════════════════');
    console.log(`점수 분포            : ${stats.scoreDist}`);
    console.log(`갭 분포              : ${stats.gapDist}`);
    console.log(`평가자평균점수 분산  : ${stats.evaluatorMeanVariance}`);
    console.log(`연도간 ρ (weighted) : ${stats.yearRho}`);
    console.log(`기간내 전보 건수     : ${stats.intraTransferCount}`);
    console.log(`의견 unique율        : ${stats.feedbackUniqPct}% (${stats.feedbackUniq}/${stats.feedbackTotal})`);
    console.log(`짧은 의견(<30자)     : ${stats.shortFb}건`);
    console.log(`의견 누락 과업       : ${stats.missingFb}건`);
    console.log(`가중치≠100 평가      : ${stats.weightBadFinal}건 (목표 17±2건)`);
    console.log(`완료/진행중          : ${stats.completionDist}`);
    console.log(`score=0 주입         : ${scoreZeroInjected ? '1건' : '0건'}`);
    console.log('═══════════════════════════════════════════════════');

    // ── COMMIT / ROLLBACK ──────────────────────────────────────────────
    if (DRY_RUN) {
      await c.query('ROLLBACK');
      console.log('\n[DRY_RUN] ROLLBACK 완료. 실제 적용하려면 RECONSTRUCT_COMMIT=1 로 재실행하세요.');
    } else {
      await c.query('COMMIT');
      console.log('\n[COMMIT] 완료. 데이터가 실제로 반영되었습니다.');
    }

  } catch (err) {
    await c.query('ROLLBACK');
    console.error('\n[ERROR] ROLLBACK:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
