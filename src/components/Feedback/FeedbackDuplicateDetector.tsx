import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { evaluationService, taskEvaluationEntryService } from '@/lib/services';
import type { Evaluation, TaskEvaluationEntry } from '@/types';
import { reviewFeedbackPairSimilarity } from '@/lib/gptOss';

// ─────────────────────────────────────────────────────────────────────────────
// F-C3 평가의견 복붙(중복) 탐지 (read-only)
//
// 목적: 한 평가자가 자신의 여러 피평가자에게 같은/거의 같은 평가의견을 붙인 경우(복붙)를
//       "정황"으로만 제시한다. 단정하지 않으며, 발령으로 한 평가자가 여러 피평가자를 맡거나
//       비슷한 표현을 쓰는 것은 정상으로 본다.
//
// 비용 정책:
//  - 로드 시 OpenAI/GPT-OSS 호출 0건. read-only 조회 + 동기 휴리스틱(정규화 해시·편집거리)만.
//  - 완전/근사 중복은 클라이언트 휴리스틱으로 즉시 탐지(복붙은 대개 동일 텍스트).
//  - AI 유사도(reviewFeedbackPairSimilarity)는 '경계 쌍'에만 행 버튼/배치 온디맨드로 호출하고
//    대칭 pairKey 로 결과 캐싱한다. 텍스트가 바뀌면 해시가 달라져 캐시가 자동 무효화된다.
//  - 전체 의견쌍 O(n²) AI 호출 금지: 후보를 정규화 유사도(0.75 ≤ sim < 0.90)로 제한하고
//    배치 상한·동시성 캡을 둔다.
//
// 오탐 방지:
//  - 짧은 정형 단문("기대수준 충족" 등)은 우연히 같을 수 있으므로 trivial 로 강등해 중복
//    카운트에서 분리하고 '정형 단문'으로 약하게만 표기한다.
//  - 1차 강등 기준은 정규식이 아니라 길이·고유단어수 임계(누락 오탐 최소화).
//
// read-only:
//  - 쓰기 종착은 evaluationService.requestReturn 단 하나(알림만, 점수·상태 무변경).
//  - 로드·휴리스틱·AI 결과·캐시는 전부 컴포넌트 메모리(state) 한정. DB/서버 미기록.
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_LIMIT = 20; // 1회 배치 상한
const BATCH_CONCURRENCY = 3; // 배치 동시성 캡

// 근사 중복 임계 (정규화 후 편집거리 기반 유사도)
const EXACT_SIM = 1; // 정규화 완전 일치
const NEAR_SIM = 0.9; // 0.90 이상: 근사 중복(휴리스틱 확정, AI 미호출)
const BORDERLINE_SIM = 0.75; // 0.75 ≤ sim < 0.90: 경계(AI 온디맨드 대상)
const MAX_LEN_RATIO_DIFF = 0.25; // 길이차 비율 >0.25 면 편집거리 계산 스킵(보정 3)

// trivial(정형 단문) 강등 임계 (보정 4: 1차 기준은 길이·고유단어수)
const TRIVIAL_MIN_LEN = 30; // 정규화 전 trim 길이 < 30
const TRIVIAL_MIN_NORM_LEN = 20; // 정규화 길이 < 20
const TRIVIAL_MIN_UNIQUE_WORDS = 6; // 고유 단어 < 6

// 정형문 정규식(보조 신호) — 매칭되면 trivial 보강. 단독 1차 기준은 아님.
const GENERIC_PATTERNS = [
  /^(좋았습니다?|잘했습니다?|수고했습니다?|고생했습니다?)\.?$/i,
  /^(열심히\s*했습니다?|성실했습니다?|적극적이었습니다?)\.?$/i,
  /^(계속\s*이런\s*식으로\s*해주세요|앞으로도\s*잘\s*부탁드립니다?)\.?$/i,
  /^(만족스럽습니다?|괜찮습니다?|무난합니다?)\.?$/i,
];

// 정규화: 소문자 + 공백 단일화 + 문장부호 제거 (복붙은 대개 정규화 후 동일)
const normalizeText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[.,!?;:·…“”"'’‘()\[\]{}\-–—~/\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// 가벼운 결정적 해시 (텍스트 변경 감지·완전중복 그룹핑용 — 보안 목적 아님)
const hashText = (text: string): string => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return `${text.length}_${(h >>> 0).toString(36)}`;
};

const uniqueWordCount = (norm: string): number => {
  if (!norm) return 0;
  return new Set(norm.split(' ').filter(Boolean)).size;
};

// trivial(정형 단문) 판정 — 1차: 길이·고유단어수 임계, 보조: 정형문 정규식
const isTrivial = (raw: string, norm: string): boolean => {
  if (raw.trim().length < TRIVIAL_MIN_LEN) return true;
  if (norm.length < TRIVIAL_MIN_NORM_LEN) return true;
  if (uniqueWordCount(norm) < TRIVIAL_MIN_UNIQUE_WORDS) return true;
  if (GENERIC_PATTERNS.some((p) => p.test(raw.trim()))) return true;
  return false;
};

// 경량 자체 Levenshtein DP — 외부 의존성 없이 음절(코드포인트) 단위 편집거리.
// 길이 상한이 큰 경우를 대비해 호출 전 prefilter(길이차 비율)로 보호한다(보정 3).
const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j += 1) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
};

// 정규화 문자열 유사도(0~1). 길이차 비율이 크면 계산 스킵하고 0 처리(보정 3).
const normalizedSimilarity = (normA: string, normB: string): number => {
  if (normA === normB) return EXACT_SIM;
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 0;
  if (Math.abs(normA.length - normB.length) / maxLen > MAX_LEN_RATIO_DIFF) return 0;
  const dist = editDistance(normA, normB);
  return 1 - dist / maxLen;
};

// 대칭 pairKey — (해시 정렬)로 (a,b)와 (b,a)가 동일 키. 텍스트 변경 시 해시가 달라져 자동 무효화.
const pairKeyOf = (evaluatorKey: string, hashA: string, hashB: string): string => {
  const [x, y] = hashA <= hashB ? [hashA, hashB] : [hashB, hashA];
  return `${evaluatorKey}|${x}|${y}`;
};

type DupKind = 'exact' | 'near' | 'borderline';

type OpinionItem = {
  key: string; // entry.id + feedback hash
  entryId: string;
  evaluationId: string;
  evaluateeName: string;
  evaluateeDepartment: string;
  evaluatorKey: string; // entry.evaluator_id 우선 → name:폴백
  evaluatorName: string;
  feedback: string;
  norm: string;
  normHash: string;
  trivial: boolean;
  lastModified: string | null;
};

type DupPair = {
  pairKey: string;
  evaluatorKey: string;
  evaluatorName: string;
  a: OpinionItem;
  b: OpinionItem;
  kind: DupKind;
  similarity: number; // 정규화 유사도(0~1)
};

type AiState = 'idle' | 'loading' | 'done' | 'error';
type AiVerdict = {
  isSimilar: boolean;
  summary: string;
  skipped: boolean;
};

// 제한 동시성 순회 — 배치 호출 폭주 방지
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      await worker(next);
    }
  });
  await Promise.all(runners);
}

// 평가자별 의견들 사이의 중복 쌍을 휴리스틱으로 산출(AI 미호출).
// trivial 의견은 우연 일치 오탐 방지를 위해 쌍 비교에서 제외한다.
const buildPairs = (items: OpinionItem[]): DupPair[] => {
  const byEvaluator = new Map<string, OpinionItem[]>();
  for (const it of items) {
    if (it.trivial) continue; // 정형 단문은 쌍 비교 제외(오탐 방지)
    const arr = byEvaluator.get(it.evaluatorKey) ?? [];
    arr.push(it);
    byEvaluator.set(it.evaluatorKey, arr);
  }

  const pairs: DupPair[] = [];
  for (const [evaluatorKey, list] of byEvaluator) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        // 서로 다른 피평가자 간 복붙만 본다(같은 피평가자의 동일 의견은 대상 아님).
        if (a.evaluationId === b.evaluationId) continue;
        const sim = normalizedSimilarity(a.norm, b.norm);
        let kind: DupKind | null = null;
        if (sim >= EXACT_SIM) kind = 'exact';
        else if (sim >= NEAR_SIM) kind = 'near';
        else if (sim >= BORDERLINE_SIM) kind = 'borderline';
        if (!kind) continue;
        pairs.push({
          pairKey: pairKeyOf(evaluatorKey, a.normHash, b.normHash),
          evaluatorKey,
          evaluatorName: a.evaluatorName,
          a,
          b,
          kind,
          similarity: sim,
        });
      }
    }
  }
  // 유사도 높은 순 → 같은 평가자끼리 묶이도록 정렬
  pairs.sort((p, q) => {
    if (q.similarity !== p.similarity) return q.similarity - p.similarity;
    return p.evaluatorName.localeCompare(q.evaluatorName, 'ko');
  });
  return pairs;
};

const kindBadgeStyle = (kind: DupKind): React.CSSProperties => {
  // 중립 톤: 위험색 단정 자제. 글자색만 OK 팔레트(--primary)/중립(--fg-muted)으로 구분.
  const color = kind === 'exact' ? 'var(--primary)' : 'var(--fg)';
  return {
    background: 'var(--bg-card)',
    color: kind === 'borderline' ? 'var(--fg-muted)' : color,
    border: '1px solid var(--border)',
  };
};

const kindLabel = (kind: DupKind): string => {
  if (kind === 'exact') return '동일 텍스트';
  if (kind === 'near') return '거의 동일';
  return '유사(경계)';
};

export const FeedbackDuplicateDetector = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { selectedPeriod, selectedPeriodId, periods, isLoading: periodLoading } =
    useEvaluationPeriod();

  const isHr = user?.role === 'hr';

  const [items, setItems] = useState<OpinionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [evaluatorFilter, setEvaluatorFilter] = useState<string>('__all__');

  // 경계 쌍 AI 결과 — 대칭 pairKey 캐시(컴포넌트 메모리). 새로고침/평가기간 변경 시 소멸.
  const [aiState, setAiState] = useState<Record<string, AiState>>({});
  const [aiResults, setAiResults] = useState<Record<string, AiVerdict>>({});
  const [aiCallCount, setAiCallCount] = useState(0);

  // ── 로드: OpenAI 0건. 평가기간 필터(필수)로 read-only 조회 후 휴리스틱만 계산 ──
  useEffect(() => {
    let cancelled = false;
    if (!selectedPeriodId) {
      setItems([]);
      return undefined;
    }

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setAiState({});
      setAiResults({});
      setAiCallCount(0);
      try {
        const evaluations: Evaluation[] = await evaluationService.getAllEvaluations({
          periodId: selectedPeriodId,
        });

        const built: OpinionItem[] = [];
        // 평가별 entry 계층 조회 (요청 폭주 방지: 평가당 1회, 동시성 4)
        await runWithConcurrency(evaluations, 4, async (evaluation) => {
          let entries: TaskEvaluationEntry[] = [];
          try {
            entries = await taskEvaluationEntryService.getEntriesByEvaluationId(evaluation.id);
          } catch {
            entries = [];
          }
          for (const entry of entries) {
            if (entry.status === 'cancelled') continue;
            const feedback = (entry.feedback ?? '').trim();
            if (!feedback) continue;

            const norm = normalizeText(feedback);
            const normHash = hashText(norm);
            // 평가자 키: entry.evaluator_id 우선 → 없으면 name 폴백.
            // 발령으로 entry별 평가자가 다른 케이스까지 정확히 잡기 위해 entry 기준으로 본다.
            const evaluatorName =
              entry.evaluator_name || evaluation.evaluator_name || '-';
            const evaluatorKey = entry.evaluator_id?.trim()
              ? entry.evaluator_id.trim()
              : `name:${evaluatorName}`;

            built.push({
              key: `${entry.id}:${normHash}`,
              entryId: entry.id,
              evaluationId: evaluation.id,
              evaluateeName: evaluation.evaluatee_name,
              evaluateeDepartment: evaluation.evaluatee_department,
              evaluatorKey,
              evaluatorName,
              feedback,
              norm,
              normHash,
              trivial: isTrivial(feedback, norm),
              lastModified: entry.updated_at ?? entry.feedback_date ?? null,
            });
          }
        });

        if (!cancelled) setItems(built);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : '평가의견을 불러오지 못했습니다.');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedPeriodId]);

  // 평가자 필터 옵션 (키→표시명)
  const evaluatorOptions = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((it) => {
      if (!map.has(it.evaluatorKey)) map.set(it.evaluatorKey, it.evaluatorName);
    });
    return Array.from(map.entries())
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [items]);

  // 휴리스틱 중복 쌍 (AI 미호출, 메모리 내 계산)
  const allPairs = useMemo(() => buildPairs(items), [items]);

  const visiblePairs = useMemo(() => {
    if (evaluatorFilter === '__all__') return allPairs;
    return allPairs.filter((p) => p.evaluatorKey === evaluatorFilter);
  }, [allPairs, evaluatorFilter]);

  const summary = useMemo(() => {
    const trivialCount = items.filter((it) => it.trivial).length;
    let exact = 0;
    let near = 0;
    let borderline = 0;
    allPairs.forEach((p) => {
      if (p.kind === 'exact') exact += 1;
      else if (p.kind === 'near') near += 1;
      else borderline += 1;
    });
    return {
      totalOpinions: items.length,
      trivialCount,
      exact,
      near,
      borderline,
    };
  }, [items, allPairs]);

  // ── 온디맨드 AI 유사도(경계 쌍 1건) — 대칭 pairKey 캐시 ──
  const reviewPairRef = useRef<(pair: DupPair) => Promise<void>>();
  const reviewPair = useCallback(
    async (pair: DupPair) => {
      if (pair.kind !== 'borderline') return; // exact/near 는 휴리스틱 확정, AI 미호출
      if (aiResults[pair.pairKey]) {
        setAiState((s) => ({ ...s, [pair.pairKey]: 'done' }));
        return;
      }
      setAiState((s) => ({ ...s, [pair.pairKey]: 'loading' }));
      try {
        const res = await reviewFeedbackPairSimilarity({
          feedbackA: pair.a.feedback,
          feedbackB: pair.b.feedback,
          evaluatorName: pair.evaluatorName,
        });
        setAiCallCount((c) => c + 1);
        setAiResults((prev) => ({
          ...prev,
          [pair.pairKey]: {
            isSimilar: res.isSimilar,
            summary: res.summary,
            skipped: res.skipped,
          },
        }));
        setAiState((s) => ({ ...s, [pair.pairKey]: 'done' }));
      } catch (err) {
        setAiState((s) => ({ ...s, [pair.pairKey]: 'error' }));
        toast({
          title: 'AI 유사도 검수 실패',
          description: err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요.',
          variant: 'destructive',
        });
      }
    },
    [aiResults, toast],
  );
  reviewPairRef.current = reviewPair;

  // ── 경계 쌍 배치 검수 (상한 20 / 동시성 캡 3) ──
  const [batchRunning, setBatchRunning] = useState(false);
  const reviewBorderlineBatch = useCallback(async () => {
    const targets = visiblePairs.filter(
      (p) => p.kind === 'borderline' && !aiResults[p.pairKey],
    );
    if (targets.length === 0) {
      toast({
        title: '검수할 경계 쌍이 없습니다.',
        description: '경계(유사) 쌍이 없거나 이미 모두 검수되었습니다.',
      });
      return;
    }
    if (targets.length > BATCH_LIMIT) {
      toast({
        title: `배치 상한 초과 (${targets.length}건)`,
        description: `1회 최대 ${BATCH_LIMIT}건까지 검수합니다. 앞쪽 ${BATCH_LIMIT}건만 처리합니다.`,
      });
    }
    const batch = targets.slice(0, BATCH_LIMIT);
    setBatchRunning(true);
    try {
      await runWithConcurrency(batch, BATCH_CONCURRENCY, (p) => reviewPairRef.current!(p));
    } finally {
      setBatchRunning(false);
    }
  }, [visiblePairs, aiResults, toast]);

  // ── HR 재검토 요청 (기존 return-request 재사용, 명시 액션 + 확인 단계) ──
  // 한 쌍은 두 evaluationId 를 가로지르므로, 어느 평가의 담당 평가자에게 보낼지 선택하게 한다.
  const [requestPair, setRequestPair] = useState<DupPair | null>(null);
  const [requestTargetEvalId, setRequestTargetEvalId] = useState<string>('');
  const [requestComment, setRequestComment] = useState('');
  const [requestSending, setRequestSending] = useState(false);
  // 발송 완료 표시(메모리 전용): evaluationId 단위. 새로고침/평가기간 변경 시 소멸.
  const [requestedEvalIds, setRequestedEvalIds] = useState<Set<string>>(new Set());

  const openRequest = (pair: DupPair) => {
    setRequestPair(pair);
    setRequestTargetEvalId(pair.a.evaluationId);
    setRequestComment('');
  };
  const closeRequest = () => {
    if (requestSending) return;
    setRequestPair(null);
    setRequestComment('');
  };

  const sendRequest = useCallback(async () => {
    const pair = requestPair;
    const comment = requestComment.trim();
    if (!pair || !comment || !requestTargetEvalId) return;
    if (!user?.employeeId) {
      toast({
        title: '요청 보낼 수 없음',
        description: '로그인 정보를 확인할 수 없습니다.',
        variant: 'destructive',
      });
      return;
    }
    setRequestSending(true);
    try {
      await evaluationService.requestReturn(requestTargetEvalId, {
        requestedBy: user.employeeId,
        reason: comment,
        origin: 'hr',
      });
      setRequestedEvalIds((prev) => new Set(prev).add(requestTargetEvalId));
      toast({
        title: '재검토 요청을 보냈습니다.',
        description: '선택한 평가의 담당 평가자에게 알림이 전달되었습니다.',
      });
      setRequestPair(null);
      setRequestComment('');
    } catch (err) {
      toast({
        title: '재검토 요청 실패',
        description: err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setRequestSending(false);
    }
  }, [requestPair, requestComment, requestTargetEvalId, user?.employeeId, toast]);

  // ── 비어있는/로딩 상태 ──
  if (periodLoading) {
    return <p style={{ color: 'var(--fg-muted)' }}>평가기간을 불러오는 중…</p>;
  }
  if (periods.length === 0) {
    return <p style={{ color: 'var(--fg-muted)' }}>등록된 평가기간이 없습니다.</p>;
  }
  if (!selectedPeriodId) {
    return <p style={{ color: 'var(--fg-muted)' }}>상단에서 평가기간을 먼저 선택해 주세요.</p>;
  }

  const cellStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
    verticalAlign: 'top',
    fontSize: 13,
  };
  const headStyle: React.CSSProperties = {
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: 12,
    color: 'var(--fg-muted)',
    fontWeight: 600,
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };

  const renderOpinionCell = (it: OpinionItem) => (
    <div>
      <div style={{ fontWeight: 600 }}>{it.evaluateeName}</div>
      <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{it.evaluateeDepartment}</div>
      <div
        style={{
          color: 'var(--fg)',
          lineHeight: 1.5,
          marginTop: 4,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
        title={it.feedback}
      >
        {it.feedback}
      </div>
    </div>
  );

  const renderAiVerdict = (pair: DupPair) => {
    if (pair.kind !== 'borderline') {
      return <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>휴리스틱 확정</span>;
    }
    const state = aiState[pair.pairKey] ?? 'idle';
    const cached = aiResults[pair.pairKey];
    if (state === 'loading') {
      return <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>검수 중…</span>;
    }
    if (!cached) {
      return <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>―</span>;
    }
    if (cached.skipped) {
      return (
        <span style={{ color: 'var(--fg-muted)', fontSize: 12 }} title={cached.summary}>
          판단 보류
        </span>
      );
    }
    return cached.isSimilar ? (
      <Badge variant="secondary" title={cached.summary}>
        재사용 정황
      </Badge>
    ) : (
      <Badge variant="outline" style={{ color: 'var(--fg-muted)' }} title={cached.summary}>
        서로 다름
      </Badge>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 안내 — 단정 금지, 발령 정상 */}
      <div
        style={{
          padding: 14,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          fontSize: 13,
          color: 'var(--fg-muted)',
          lineHeight: 1.6,
        }}
      >
        같은 평가자가 자신의 여러 피평가자에게 같은/거의 같은 의견을 붙인 <strong>정황</strong>을
        모아 보여줍니다. 발령으로 한 평가자가 여러 피평가자를 맡거나 비슷한 표현을 쓰는 것은
        정상일 수 있으므로 <strong>단정하지 않습니다</strong>. 정형 단문(예: “기대수준 충족”)은
        우연히 같을 수 있어 별도 표기하고 중복 집계에서 제외합니다.
      </div>

      {/* 요약 스트립 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          padding: 16,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
        }}
      >
        <SummaryStat label="평가의견" value={summary.totalOpinions} />
        <SummaryStat label="동일 텍스트 쌍" value={summary.exact} />
        <SummaryStat label="거의 동일 쌍" value={summary.near} />
        <SummaryStat label="경계(유사) 쌍" value={summary.borderline} muted />
        <SummaryStat label="정형 단문(제외)" value={summary.trivialCount} muted />
        <div style={{ flex: 1 }} />
        <SummaryStat label="AI 검수 호출" value={aiCallCount} muted />
      </div>

      {/* 컨트롤 바 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={evaluatorFilter} onValueChange={setEvaluatorFilter}>
          <SelectTrigger style={{ width: 220 }}>
            <SelectValue placeholder="평가자 전체" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">평가자 전체</SelectItem>
            {evaluatorOptions.map((opt) => (
              <SelectItem key={opt.key} value={opt.key}>
                {opt.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div style={{ flex: 1 }} />

        <Button size="sm" onClick={reviewBorderlineBatch} disabled={batchRunning}>
          {batchRunning ? '검수 중…' : `경계 쌍 AI 검수 (최대 ${BATCH_LIMIT})`}
        </Button>
      </div>

      {loadError && (
        <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>불러오기 오류: {loadError}</p>
      )}

      {/* 테이블 */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headStyle}>평가자</th>
              <th style={headStyle}>의견 A</th>
              <th style={headStyle}>의견 B</th>
              <th style={{ ...headStyle, width: 110 }}>정황</th>
              <th style={{ ...headStyle, width: 120 }}>AI 검수</th>
              <th style={{ ...headStyle, width: 170 }}>액션</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} style={{ ...cellStyle, color: 'var(--fg-muted)', textAlign: 'center' }}>
                  평가의견을 불러오는 중…
                </td>
              </tr>
            )}
            {!loading && visiblePairs.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...cellStyle, color: 'var(--fg-muted)', textAlign: 'center' }}>
                  중복/유사 정황이 발견되지 않았습니다.
                </td>
              </tr>
            )}
            {!loading &&
              visiblePairs.map((pair) => {
                const state = aiState[pair.pairKey] ?? 'idle';
                const aReq = requestedEvalIds.has(pair.a.evaluationId);
                const bReq = requestedEvalIds.has(pair.b.evaluationId);
                return (
                  <tr key={pair.pairKey}>
                    <td style={cellStyle}>
                      <div style={{ fontWeight: 600 }}>{pair.evaluatorName}</div>
                      <div style={{ color: 'var(--fg-muted)', fontSize: 11, marginTop: 4 }}>
                        유사도 {(pair.similarity * 100).toFixed(0)}%
                      </div>
                    </td>
                    <td style={{ ...cellStyle, maxWidth: 280 }}>{renderOpinionCell(pair.a)}</td>
                    <td style={{ ...cellStyle, maxWidth: 280 }}>{renderOpinionCell(pair.b)}</td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          ...kindBadgeStyle(pair.kind),
                          display: 'inline-block',
                          borderRadius: 999,
                          padding: '1px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                          width: 'fit-content',
                        }}
                      >
                        {kindLabel(pair.kind)}
                      </span>
                    </td>
                    <td style={cellStyle}>{renderAiVerdict(pair)}</td>
                    <td style={cellStyle}>
                      <div className="flex flex-col items-start gap-1">
                        {pair.kind === 'borderline' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => reviewPair(pair)}
                            disabled={state === 'loading'}
                          >
                            {state === 'loading' ? 'AI 검수 중' : 'AI 유사도 검수'}
                          </Button>
                        )}
                        {isHr && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openRequest(pair)}
                            disabled={aReq && bReq}
                            title={
                              aReq && bReq
                                ? '두 평가 모두 이미 재검토 요청을 보냈습니다.'
                                : '담당 평가자에게 재검토를 요청합니다.'
                            }
                          >
                            {aReq && bReq ? '요청 보냄' : '재검토 요청'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <p style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
        읽기 전용 모니터링입니다. 완전·근사 중복은 화면 로드 시 동기 휴리스틱(정규화·편집거리)으로
        즉시 표시되며 AI를 호출하지 않습니다. ‘유사(경계)’ 쌍만 ‘AI 유사도 검수’ 또는 ‘경계 쌍
        AI 검수’ 버튼을 눌렀을 때 온디맨드로 검수합니다. 결과는 화면에만 표시되며 저장·통지되지
        않습니다.
        {isHr ? ' ‘재검토 요청’은 선택한 평가의 담당 평가자에게 알림만 보내며 평가 점수·상태를 변경하지 않습니다.' : ''}
        {selectedPeriod ? ` 평가기간: ${selectedPeriod.name}.` : ''}
      </p>

      {/* HR 재검토 요청 — 명시 액션 + 확인 단계. 어느 평가의 담당자에게 보낼지 선택. */}
      <AlertDialog
        open={requestPair !== null}
        onOpenChange={(open) => {
          if (!open) closeRequest();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>HR 재검토 요청</AlertDialogTitle>
            <AlertDialogDescription>
              담당 평가자에게 평가의견 재검토를 요청하는 알림을 보냅니다. 평가 점수·내용·상태는
              변경되지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {requestPair && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 13,
                }}
              >
                <div style={{ marginBottom: 6, fontWeight: 600 }}>
                  대상 평가 선택 (평가자: {requestPair.evaluatorName})
                </div>
                <div style={{ color: 'var(--fg-muted)', fontSize: 12, marginBottom: 8 }}>
                  이 쌍은 두 피평가자의 평가에 걸쳐 있습니다. 어느 평가의 담당 평가자에게 알림을
                  보낼지 고르세요. 발송 시점에 배정된 담당 평가자에게 전달됩니다.
                </div>
                <Select value={requestTargetEvalId} onValueChange={setRequestTargetEvalId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value={requestPair.a.evaluationId}
                      disabled={requestedEvalIds.has(requestPair.a.evaluationId)}
                    >
                      {requestPair.a.evaluateeName} 평가
                      {requestedEvalIds.has(requestPair.a.evaluationId) ? ' (요청 보냄)' : ''}
                    </SelectItem>
                    <SelectItem
                      value={requestPair.b.evaluationId}
                      disabled={requestedEvalIds.has(requestPair.b.evaluationId)}
                    >
                      {requestPair.b.evaluateeName} 평가
                      {requestedEvalIds.has(requestPair.b.evaluationId) ? ' (요청 보냄)' : ''}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>재검토 코멘트 (필수)</span>
                <Textarea
                  value={requestComment}
                  onChange={(e) => setRequestComment(e.target.value)}
                  placeholder="어떤 점을 재검토하면 좋을지 평가자에게 전달할 내용을 적어 주세요."
                  rows={4}
                  disabled={requestSending}
                />
              </label>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={requestSending}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void sendRequest();
              }}
              disabled={
                requestSending ||
                requestComment.trim().length === 0 ||
                !requestTargetEvalId ||
                requestedEvalIds.has(requestTargetEvalId)
              }
            >
              {requestSending ? '보내는 중…' : '재검토 요청 보내기'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const SummaryStat = ({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) => (
  <div style={{ minWidth: 96 }}>
    <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{label}</div>
    <div
      style={{
        fontSize: 22,
        fontWeight: 700,
        color: muted ? 'var(--fg-muted)' : 'var(--fg)',
        lineHeight: 1.2,
      }}
    >
      {value}
    </div>
  </div>
);

export default FeedbackDuplicateDetector;
