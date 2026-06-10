import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { feedbackValidation } from '@/utils/validation';
import { CONSTANTS } from '@/types';
import type { Evaluation, TaskEvaluationEntry } from '@/types';
import {
  getScoreGapBucket,
  SCORE_GAP_EXPECTATIONS,
  type ScoreGapBucket,
} from '@/lib/evaluationMatrix';
import { detectGenericFeedback, reviewSentimentGap } from '@/lib/gptOss';

// ─────────────────────────────────────────────────────────────────────────────
// F-B2.1 AI 검수 모니터링 (read-only)
// - 로드 시 OpenAI/GPT-OSS 호출 0건. 휴리스틱 2종(짧음·무의미)만 동기 계산.
// - 비구체·정서불일치는 행 '검수' 버튼 또는 '선택 AI 검수' 배치에서만 온디맨드 호출.
// - 결과는 컴포넌트 메모리 캐시(Map)에만 보존. DB/서버에 일절 쓰지 않음.
// - 평가자 통지·반려·평가 수정/저장 등 쓰기 동작 없음.
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_LIMIT = 20; // 1회 배치 상한
const BATCH_CONCURRENCY = 3; // 배치 동시성 캡

type HeuristicFlag = 'short' | 'meaningless';

type AiState = 'idle' | 'loading' | 'done' | 'error';

type AiResult = {
  // 비구체 (정규식 선판정 + AI 최종판정)
  generic: 'unknown' | 'concrete' | 'generic';
  genericReason?: string;
  // 정서-갭 정합성
  sentiment: 'unknown' | 'match' | 'mismatch' | 'skipped';
  sentimentReason?: string;
  feedbackHash: string; // 검수 시점의 의견 해시 (텍스트 변경 감지용)
};

type OpinionRow = {
  key: string; // entry.id + feedback hash
  entryId: string;
  evaluationId: string;
  evaluateeName: string;
  evaluateeDepartment: string;
  evaluatorName: string;
  taskId: string;
  feedback: string;
  feedbackHash: string;
  score: number | null;
  growthLevel: number;
  gapBucket: ScoreGapBucket | null; // growth_level/score 유효성 가드 통과 시에만
  heuristics: HeuristicFlag[];
  lastModified: string | null;
};

// 가벼운 결정적 해시 (텍스트 변경 감지용 — 보안 목적 아님)
const hashText = (text: string): string => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h << 5) - h + text.charCodeAt(i);
    h |= 0;
  }
  return `${text.length}_${(h >>> 0).toString(36)}`;
};

// 짧음: 길이<30자 또는 (문장수<MIN && 길이<50자)
const isShort = (feedback: string): boolean => {
  const text = feedback.trim();
  if (!feedbackValidation.checkLength(text)) return true; // < MIN_FEEDBACK_LENGTH(30)
  if (!feedbackValidation.checkSentenceCount(text) && text.length < 50) return true;
  return false;
};

const computeHeuristics = (feedback: string): HeuristicFlag[] => {
  const flags: HeuristicFlag[] = [];
  const text = feedback.trim();
  if (!text) return flags;
  if (isShort(text)) flags.push('short');
  if (!feedbackValidation.detectMeaninglessContent(text).isValid) flags.push('meaningless');
  return flags;
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

const gapBadgeStyle = (bucket: ScoreGapBucket): React.CSSProperties => {
  // 중립 톤 유지: 위험색 단정 자제. 갭버킷별로 글자색만 OK 팔레트(--primary) / 중립(--fg, --fg-muted)으로 구분.
  const map: Record<ScoreGapBucket, string> = {
    exceed: 'var(--primary)',
    meet: 'var(--fg)',
    near: 'var(--fg-muted)',
    below: 'var(--fg-muted)',
  };
  return { background: 'var(--bg-card)', color: map[bucket], border: '1px solid var(--border)' };
};

export const AiReviewMonitoring = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { selectedPeriod, selectedPeriodId, periods, isLoading: periodLoading } =
    useEvaluationPeriod();

  // HR 전용 surface지만 액션 게이트는 명시적으로 확인한다.
  const isHr = user?.role === 'hr';

  const [rows, setRows] = useState<OpinionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 행별 AI 검수 상태/결과 — 컴포넌트 메모리 캐시(state). 새로고침/평가기간 변경 시 소멸.
  // 캐시 키는 opinionKey = entry.id + feedback 해시. 텍스트가 바뀌면 키가 달라져 자동 무효화된다.
  const [aiState, setAiState] = useState<Record<string, AiState>>({});
  const [aiResults, setAiResults] = useState<Record<string, AiResult>>({});

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'flagged'>('all');
  const [evaluatorFilter, setEvaluatorFilter] = useState<string>('__all__');
  const [aiCallCount, setAiCallCount] = useState(0);

  // ── 로드: OpenAI 0건. 평가기간 필터(필수)로 read-only 조회 후 휴리스틱만 계산 ──
  useEffect(() => {
    let cancelled = false;
    if (!selectedPeriodId) {
      setRows([]);
      return undefined;
    }

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setSelected(new Set());
      setAiState({});
      setAiResults({});
      setAiCallCount(0);
      try {
        const evaluations: Evaluation[] = await evaluationService.getAllEvaluations({
          periodId: selectedPeriodId,
        });

        const built: OpinionRow[] = [];
        // 평가별 entry 계층 조회 (요청 폭주 방지: 평가당 1회)
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

            const growthLevel = evaluation.growth_level;
            const hasValidGap =
              entry.score != null &&
              entry.score > 0 &&
              Number.isFinite(Number(growthLevel)) &&
              Number(growthLevel) > 0;
            const gapBucket = hasValidGap
              ? getScoreGapBucket(entry.score as number, growthLevel)
              : null;

            const feedbackHash = hashText(feedback);
            built.push({
              key: `${entry.id}:${feedbackHash}`,
              entryId: entry.id,
              evaluationId: evaluation.id,
              evaluateeName: evaluation.evaluatee_name,
              evaluateeDepartment: evaluation.evaluatee_department,
              evaluatorName: entry.evaluator_name || evaluation.evaluator_name || '-',
              taskId: entry.task_id,
              feedback,
              feedbackHash,
              score: entry.score,
              growthLevel,
              gapBucket,
              heuristics: computeHeuristics(feedback),
              lastModified: entry.updated_at ?? entry.feedback_date ?? null,
            });
          }
        });

        if (!cancelled) {
          built.sort((a, b) => a.evaluateeName.localeCompare(b.evaluateeName, 'ko'));
          setRows(built);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : '평가의견을 불러오지 못했습니다.');
          setRows([]);
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

  const evaluatorNames = useMemo(() => {
    const names = new Set<string>();
    rows.forEach((r) => names.add(r.evaluatorName));
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [rows]);

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (evaluatorFilter !== '__all__' && r.evaluatorName !== evaluatorFilter) return false;
      if (filter === 'flagged') {
        const cached = aiResults[r.key];
        const flagged =
          r.heuristics.length > 0 ||
          cached?.generic === 'generic' ||
          cached?.sentiment === 'mismatch';
        if (!flagged) return false;
      }
      return true;
    });
  }, [rows, filter, evaluatorFilter, aiResults]);

  // 필터로 숨겨진 행이 selected에 잔존하면 "선택 N건"과 배치 처리 건수가 어긋난다 — 보이는 행으로 한정
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visibleKeys = new Set(visibleRows.map((r) => r.key));
      const next = new Set(Array.from(prev).filter((key) => visibleKeys.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleRows]);

  // ── 요약 통계 (로드 시 휴리스틱만 집계, AI는 호출된 것만) ──
  const summary = useMemo(() => {
    let shortCount = 0;
    let meaninglessCount = 0;
    let genericCount = 0;
    let mismatchCount = 0;
    rows.forEach((r) => {
      if (r.heuristics.includes('short')) shortCount += 1;
      if (r.heuristics.includes('meaningless')) meaninglessCount += 1;
      const cached = aiResults[r.key];
      if (cached?.generic === 'generic') genericCount += 1;
      if (cached?.sentiment === 'mismatch') mismatchCount += 1;
    });
    return {
      total: rows.length,
      shortCount,
      meaninglessCount,
      genericCount,
      mismatchCount,
    };
  }, [rows, aiResults]);

  // ── 온디맨드 AI 검수 (1행) — 비구체 + 정서-갭 ──
  // 캐시 히트 시(같은 opinionKey 결과가 이미 있으면) 재호출 차단. 텍스트 변경 시 key가 달라져 미스.
  const reviewRowRef = useRef<(row: OpinionRow) => Promise<void>>();
  const reviewRow = useCallback(
    async (row: OpinionRow) => {
      if (aiResults[row.key]) {
        setAiState((s) => ({ ...s, [row.key]: 'done' }));
        return;
      }

      setAiState((s) => ({ ...s, [row.key]: 'loading' }));
      try {
        // 1) 비구체: 정규식 선판정 → AI 최종판정 (1차 정규식 단독으로 확정 배지 달지 않음)
        const genericCheck = await detectGenericFeedback(row.feedback);
        setAiCallCount((c) => c + 1);

        // 2) 정서-갭: 갭버킷이 유효할 때만
        let sentiment: AiResult['sentiment'] = 'skipped';
        let sentimentReason: string | undefined;
        if (row.gapBucket && row.score != null) {
          const exp = SCORE_GAP_EXPECTATIONS[row.gapBucket];
          const res = await reviewSentimentGap({
            feedback: row.feedback,
            bucketLabel: exp.label,
            bucketDetail: exp.detail,
            score: row.score,
            growthLevel: row.growthLevel,
          });
          setAiCallCount((c) => c + 1);
          if (res.skipped) {
            sentiment = 'skipped';
          } else {
            sentiment = res.isMismatch ? 'mismatch' : 'match';
          }
          sentimentReason = res.summary;
        }

        setAiResults((prev) => ({
          ...prev,
          [row.key]: {
            generic: genericCheck.isGeneric ? 'generic' : 'concrete',
            genericReason: genericCheck.reason,
            sentiment,
            sentimentReason,
            feedbackHash: row.feedbackHash,
          },
        }));
        setAiState((s) => ({ ...s, [row.key]: 'done' }));
      } catch (err) {
        setAiState((s) => ({ ...s, [row.key]: 'error' }));
        toast({
          title: 'AI 검수 실패',
          description: err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요.',
          variant: 'destructive',
        });
      }
    },
    [aiResults, toast],
  );
  reviewRowRef.current = reviewRow;

  // ── 선택 배치 검수 (상한 20 / 동시성 캡 3) ──
  const [batchRunning, setBatchRunning] = useState(false);
  const reviewSelected = useCallback(async () => {
    const targets = visibleRows.filter((r) => selected.has(r.key));
    if (targets.length === 0) {
      toast({ title: '선택된 의견이 없습니다.', description: '검수할 행을 먼저 선택하세요.' });
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
      await runWithConcurrency(batch, BATCH_CONCURRENCY, (row) => reviewRowRef.current!(row));
    } finally {
      setBatchRunning(false);
    }
  }, [visibleRows, selected, toast]);

  // ── HR 재검토 요청 (기존 return-request 메커니즘 재사용, 명시 액션 + 확인 단계) ──
  // 자동 발송 없음: 행 버튼은 다이얼로그만 연다. 확인(AlertDialogAction) 시에만 1건 발송.
  // 평가 점수·상태를 변경하지 않는다 — return-request는 알림만 발송(서버 status 무변경).
  const [reviewRequestRow, setReviewRequestRow] = useState<OpinionRow | null>(null);
  const [reviewRequestComment, setReviewRequestComment] = useState('');
  const [reviewRequestSending, setReviewRequestSending] = useState(false);
  // 발송 완료 표시(메모리 전용): 새로고침·평가기간 변경 시 소멸. 컴포넌트의 무영속 정책과 일치.
  const [requestedKeys, setRequestedKeys] = useState<Set<string>>(new Set());

  const openReviewRequest = (row: OpinionRow) => {
    setReviewRequestRow(row);
    setReviewRequestComment('');
  };
  const closeReviewRequest = () => {
    if (reviewRequestSending) return;
    setReviewRequestRow(null);
    setReviewRequestComment('');
  };

  const sendReviewRequest = useCallback(async () => {
    const row = reviewRequestRow;
    const comment = reviewRequestComment.trim();
    if (!row || !comment) return;
    if (!user?.employeeId) {
      toast({
        title: '요청 보낼 수 없음',
        description: '로그인 정보를 확인할 수 없습니다.',
        variant: 'destructive',
      });
      return;
    }
    setReviewRequestSending(true);
    try {
      const result = await evaluationService.requestReturn(row.evaluationId, {
        requestedBy: user.employeeId,
        reason: comment,
        origin: 'hr',
      });
      // 평가 단위로 표시(같은 평가의 여러 플래그 항목을 함께 '요청 보냄' 처리·재발송 차단)
      setRequestedKeys((prev) => new Set(prev).add(row.evaluationId));
      toast({
        title: '재검토 요청을 보냈습니다.',
        description: result.recipient_id
          ? '해당 평가의 담당 평가자에게 알림이 전달되었습니다.'
          : '담당 평가자에게 알림이 전달되었습니다.',
      });
      setReviewRequestRow(null);
      setReviewRequestComment('');
    } catch (err) {
      toast({
        title: '재검토 요청 실패',
        description: err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요.',
        variant: 'destructive',
      });
    } finally {
      setReviewRequestSending(false);
    }
  }, [reviewRequestRow, reviewRequestComment, user?.employeeId, toast]);

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.key));
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        visibleRows.forEach((r) => next.delete(r.key));
        return next;
      }
      const next = new Set(prev);
      visibleRows.forEach((r) => next.add(r.key));
      return next;
    });
  };

  // ── 렌더 헬퍼 ──
  const renderHeuristicBadges = (row: OpinionRow) => {
    if (row.heuristics.length === 0) {
      return <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>―</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {row.heuristics.includes('short') && (
          <Badge variant="secondary" title={`길이 ${row.feedback.trim().length}자 (최소 ${CONSTANTS.MIN_FEEDBACK_LENGTH}자)`}>
            짧음
          </Badge>
        )}
        {row.heuristics.includes('meaningless') && (
          <Badge variant="outline" style={{ color: 'var(--fg-muted)' }}>
            무의미
          </Badge>
        )}
      </div>
    );
  };

  const renderAiBadges = (row: OpinionRow) => {
    const state = aiState[row.key] ?? 'idle';
    const cached = aiResults[row.key];

    if (state === 'loading') {
      return <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>검수 중…</span>;
    }
    if (!cached) {
      return <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>―</span>;
    }

    return (
      <div className="flex flex-wrap items-center gap-1">
        {cached.generic === 'generic' && (
          <Badge variant="secondary" title={cached.genericReason}>
            비구체
          </Badge>
        )}
        {cached.generic === 'concrete' && (
          <Badge variant="outline" style={{ color: 'var(--fg-muted)' }}>
            구체적
          </Badge>
        )}
        {cached.sentiment === 'mismatch' && (
          <Badge variant="secondary" title={cached.sentimentReason}>
            정서 불일치
          </Badge>
        )}
        {cached.sentiment === 'match' && (
          <Badge variant="outline" style={{ color: 'var(--fg-muted)' }} title={cached.sentimentReason}>
            정서 정합
          </Badge>
        )}
        {cached.sentiment === 'skipped' && (
          <span style={{ color: 'var(--fg-muted)', fontSize: 12 }} title={cached.sentimentReason}>
            정서 보류
          </span>
        )}
      </div>
    );
  };

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
        <SummaryStat label="평가의견" value={summary.total} />
        <SummaryStat label="짧음" value={summary.shortCount} />
        <SummaryStat label="무의미" value={summary.meaninglessCount} />
        <SummaryStat label="비구체 (AI)" value={summary.genericCount} muted />
        <SummaryStat label="정서 불일치 (AI)" value={summary.mismatchCount} muted />
        <div style={{ flex: 1 }} />
        <SummaryStat label="AI 검수 호출" value={aiCallCount} muted />
      </div>

      {/* 컨트롤 바 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={evaluatorFilter} onValueChange={setEvaluatorFilter}>
          <SelectTrigger style={{ width: 200 }}>
            <SelectValue placeholder="평가자 전체" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">평가자 전체</SelectItem>
            {evaluatorNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1" style={{ marginLeft: 4 }}>
          <Button
            size="sm"
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => setFilter('all')}
          >
            전체
          </Button>
          <Button
            size="sm"
            variant={filter === 'flagged' ? 'default' : 'outline'}
            onClick={() => setFilter('flagged')}
          >
            플래그만
          </Button>
        </div>

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          선택 {selected.size}건
        </span>
        <Button
          size="sm"
          onClick={reviewSelected}
          disabled={batchRunning || selected.size === 0}
        >
          {batchRunning ? '검수 중…' : `선택 AI 검수 (최대 ${BATCH_LIMIT})`}
        </Button>
      </div>

      {loadError && (
        <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          불러오기 오류: {loadError}
        </p>
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
              <th style={{ ...headStyle, width: 36 }}>
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="전체 선택"
                  disabled={visibleRows.length === 0}
                />
              </th>
              <th style={headStyle}>피평가자</th>
              <th style={headStyle}>평가자</th>
              <th style={headStyle}>의견</th>
              <th style={{ ...headStyle, width: 110 }}>점수·갭</th>
              <th style={{ ...headStyle, width: 120 }}>휴리스틱</th>
              <th style={{ ...headStyle, width: 160 }}>AI 검수</th>
              <th style={{ ...headStyle, width: 150 }}>액션</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} style={{ ...cellStyle, color: 'var(--fg-muted)', textAlign: 'center' }}>
                  평가의견을 불러오는 중…
                </td>
              </tr>
            )}
            {!loading && visibleRows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...cellStyle, color: 'var(--fg-muted)', textAlign: 'center' }}>
                  표시할 평가의견이 없습니다.
                </td>
              </tr>
            )}
            {!loading &&
              visibleRows.map((row) => {
                const state = aiState[row.key] ?? 'idle';
                return (
                  <tr key={row.key}>
                    <td style={cellStyle}>
                      <Checkbox
                        checked={selected.has(row.key)}
                        onCheckedChange={() => toggleSelect(row.key)}
                        aria-label={`${row.evaluateeName} 의견 선택`}
                      />
                    </td>
                    <td style={cellStyle}>
                      <div style={{ fontWeight: 600 }}>{row.evaluateeName}</div>
                      <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>
                        {row.evaluateeDepartment}
                      </div>
                    </td>
                    <td style={cellStyle}>{row.evaluatorName}</td>
                    <td style={{ ...cellStyle, maxWidth: 360 }}>
                      <div
                        style={{
                          color: 'var(--fg)',
                          lineHeight: 1.5,
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                        title={row.feedback}
                      >
                        {row.feedback}
                      </div>
                      {row.lastModified && (
                        <div style={{ color: 'var(--fg-muted)', fontSize: 11, marginTop: 4 }}>
                          최근 수정 {row.lastModified.slice(0, 10)}
                        </div>
                      )}
                    </td>
                    <td style={cellStyle}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontWeight: 600 }}>
                          {row.score != null ? row.score : '―'}
                          <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>
                            {' '}/ Lv.{row.growthLevel}
                          </span>
                        </span>
                        {row.gapBucket ? (
                          <span
                            style={{
                              ...gapBadgeStyle(row.gapBucket),
                              display: 'inline-block',
                              borderRadius: 999,
                              padding: '1px 8px',
                              fontSize: 11,
                              fontWeight: 600,
                              width: 'fit-content',
                            }}
                            title={SCORE_GAP_EXPECTATIONS[row.gapBucket].detail}
                          >
                            {SCORE_GAP_EXPECTATIONS[row.gapBucket].label}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>갭 ―</span>
                        )}
                      </div>
                    </td>
                    <td style={cellStyle}>{renderHeuristicBadges(row)}</td>
                    <td style={cellStyle}>{renderAiBadges(row)}</td>
                    <td style={cellStyle}>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reviewRow(row)}
                          disabled={state === 'loading'}
                        >
                          {state === 'loading' ? '검수 중' : '검수'}
                        </Button>
                        {isHr && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openReviewRequest(row)}
                            disabled={requestedKeys.has(row.evaluationId)}
                            title={
                              requestedKeys.has(row.evaluationId)
                                ? '이 평가에는 이미 재검토 요청을 보냈습니다.'
                                : '담당 평가자에게 재검토를 요청합니다.'
                            }
                          >
                            {requestedKeys.has(row.evaluationId) ? '요청 보냄' : '재검토 요청'}
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
        읽기 전용 모니터링입니다. 검수 결과는 화면에만 표시되며 저장·통지되지 않습니다.
        AI 검수(비구체·정서 불일치)는 행 ‘검수’ 또는 ‘선택 AI 검수’ 버튼을 눌렀을 때만 호출됩니다.
        {isHr ? ' ‘재검토 요청’은 담당 평가자에게 알림만 보내며 평가 점수·상태를 변경하지 않습니다.' : ''}
        {selectedPeriod ? ` 평가기간: ${selectedPeriod.name}.` : ''}
      </p>

      {/* HR 재검토 요청 — 명시 액션 + 확인 단계. 확인 시에만 1건 발송, 자동발송 없음. */}
      <AlertDialog
        open={reviewRequestRow !== null}
        onOpenChange={(open) => {
          if (!open) closeReviewRequest();
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

          {reviewRequestRow && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* 수신자 안내 — 표시된 평가자명이 아닌 '발송 시점의 담당 평가자'에게 전달됨을 명시 */}
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 13,
                }}
              >
                <div>
                  수신: <strong>해당 평가의 현재 담당 평가자</strong>
                </div>
                <div style={{ color: 'var(--fg-muted)', fontSize: 12, marginTop: 4 }}>
                  발송 시점에 배정된 담당 평가자에게 전달됩니다. 평가자가 변경(발령)된 경우 현재
                  담당 평가자가 알림을 받습니다. (화면 표시 기준: {reviewRequestRow.evaluatorName})
                </div>
                <div style={{ color: 'var(--fg-muted)', fontSize: 12, marginTop: 6 }}>
                  대상 평가의견:{' '}
                  <span style={{ color: 'var(--fg)' }}>
                    “
                    {reviewRequestRow.feedback.length > 80
                      ? `${reviewRequestRow.feedback.slice(0, 80)}…`
                      : reviewRequestRow.feedback}
                    ”
                  </span>
                </div>
              </div>

              <label
                style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}
              >
                <span style={{ fontWeight: 600 }}>재검토 코멘트 (필수)</span>
                <Textarea
                  value={reviewRequestComment}
                  onChange={(e) => setReviewRequestComment(e.target.value)}
                  placeholder="어떤 점을 재검토하면 좋을지 평가자에게 전달할 내용을 적어 주세요."
                  rows={4}
                  disabled={reviewRequestSending}
                />
              </label>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={reviewRequestSending}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // 확인 단계에서만 발송. 빈 코멘트/발송 중에는 다이얼로그를 닫지 않는다.
                e.preventDefault();
                void sendReviewRequest();
              }}
              disabled={reviewRequestSending || reviewRequestComment.trim().length === 0}
            >
              {reviewRequestSending ? '보내는 중…' : '재검토 요청 보내기'}
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

export default AiReviewMonitoring;
