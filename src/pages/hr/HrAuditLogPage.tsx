import { useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { auditLogService, type AuditLogRow } from '@/lib/services';
import { useToast } from '@/hooks/use-toast';

const PAGE_SIZE = 50;

// action_type → 한글 라벨(신규 F-1 + 기존 HR관리 액션). 미정의 타입은 원문 그대로 노출.
const ACTION_LABELS: Record<string, string> = {
  evaluation_score_change: '점수 변경',
  evaluation_update: '평가 상태 변경',
  evaluation_reopen: '평가 재오픈',
  task_update: '과업 수정',
  task_soft_delete: '과업 삭제(소프트)',
  task_delete: '과업 삭제',
  ai_review_change: 'AI검수 변경',
  evaluator_change: '평가자 변경',
  employee_update: '직원정보 변경',
  evaluator_correct: '평가자 정정',
  evaluator_mappings_bulk: '평가자 일괄변경',
  change_request_approve: '변경요청 승인',
  change_request_reject: '변경요청 반려',
  change_request_revert: '변경요청 되돌림',
  evaluation_period_create: '평가기간 생성',
  evaluation_period_update: '평가기간 수정',
  evaluation_period_delete: '평가기간 삭제',
  employee_profile_import: '프로필 임포트',
  matching_import: '매칭 임포트',
  password_reset_approved: '비번초기화 승인',
  password_reset_direct: '비번초기화(직접)',
  reset_employees: '직원 초기화',
  reset_matching: '매칭 초기화',
  reset_period: '평가기간 초기화',
};

const FIELD_LABELS: Record<string, string> = {
  score: '점수',
  feedback: '피드백',
  contribution_method: '기여방식',
  contribution_scope: '기여범위',
  evaluation_status: '평가상태',
  growth_level: '성장레벨',
  ai_flagged: 'AI플래그',
  ai_summary: 'AI요약',
  ai_type: 'AI유형',
  evaluator_id: '평가자',
  available_roles: '역할',
  name: '이름',
  position: '직위',
  job_role: '직무',
  on_leave: '휴직',
  title: '제목',
  weight: '가중치',
  task_id: '과업ID',
};

const actionLabel = (t: string) => ACTION_LABELS[t] ?? t;
const fieldLabel = (k: string) => FIELD_LABELS[k] ?? k;

const fmtDateTime = (v: string | null) => {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

// jsonb 값(스칼라/배열/객체/null)을 사람이 읽을 문자열로.
const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined) return '없음';
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(', ') : '없음';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

type DiffLine = { key: string; before: string; after: string };

// previous_value / new_value 를 변경된 항목만 old→new 로 정리.
const buildDiff = (prev: unknown, next: unknown): DiffLine[] => {
  const asObj = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  const po = asObj(prev);
  const no = asObj(next);
  if (!po && !no) {
    const before = fmtVal(prev);
    const after = fmtVal(next);
    return before === after ? [] : [{ key: '', before, after }];
  }
  const keys = Array.from(new Set([...(po ? Object.keys(po) : []), ...(no ? Object.keys(no) : [])]));
  return keys
    .map((k) => ({ key: k, before: fmtVal(po?.[k]), after: fmtVal(no?.[k]) }))
    .filter((line) => line.before !== line.after);
};

const truncate = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n)}…` : s);

const HrAuditLogPage = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [actionTypes, setActionTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // 필터 입력값(‘조회’ 클릭/페이지 이동 시 적용).
  const [fActionType, setFActionType] = useState('');
  const [fTarget, setFTarget] = useState('');
  const [fActor, setFActor] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');

  const load = useCallback(
    async (targetOffset: number) => {
      setLoading(true);
      try {
        const page = await auditLogService.list({
          actionType: fActionType || undefined,
          target: fTarget.trim() || undefined,
          actor: fActor.trim() || undefined,
          // 날짜 경계는 KST(+09:00) 명시 — 표시 시각이 KST이므로 필터도 KST 달력 하루 기준으로 맞춘다
          // (DB 세션 TZ에 의존하지 않도록 오프셋을 박아 캐스팅 모호성 제거). ‘종료일’은 그날 끝까지 포함.
          from: fFrom ? `${fFrom}T00:00:00+09:00` : undefined,
          to: fTo ? `${fTo}T23:59:59+09:00` : undefined,
          limit: PAGE_SIZE,
          offset: targetOffset,
        });
        setRows(page.rows);
        setTotal(page.total);
        setOffset(page.offset);
        // actionTypes 는 첫 페이지에서만 내려옴 — 비어있지 않을 때만 갱신(페이지 이동 시 보존).
        if (page.actionTypes.length) setActionTypes(page.actionTypes);
      } catch (err) {
        setRows([]);
        setTotal(0);
        toast({
          title: '감사 로그를 불러오지 못했습니다.',
          description: err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요.',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    },
    [fActionType, fTarget, fActor, fFrom, fTo, toast],
  );

  useEffect(() => {
    void load(0);
    // 최초 1회 로드. 이후는 ‘조회’/페이지 이동에서 명시 호출.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = () => {
    void load(0);
  };
  const resetFilters = () => {
    setFActionType('');
    setFTarget('');
    setFActor('');
    setFFrom('');
    setFTo('');
  };

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <div>
      <PageHeader
        title="감사 로그"
        subtitle="점수·평가자·상태·과업·AI검수 등 평가 데이터 변경의 누가/언제/이전→이후 기록입니다."
        actions={
          <button className="sd-btn sd-btn-outline sd-btn-sm" onClick={() => void load(offset)} disabled={loading}>
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        }
      />

      <div style={{ padding: '20px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 필터 바 */}
        <div className="sd-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <label style={filterLabel}>
              유형
              <select className="sd-input" value={fActionType} onChange={(e) => setFActionType(e.target.value)} style={{ minWidth: 160 }}>
                <option value="">전체</option>
                {actionTypes.map((t) => (
                  <option key={t} value={t}>
                    {actionLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterLabel}>
              대상직원 사번
              <input
                className="sd-input"
                value={fTarget}
                onChange={(e) => setFTarget(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                placeholder="예: 1000005"
                style={{ width: 130 }}
              />
            </label>
            <label style={filterLabel}>
              행위자 사번
              <input
                className="sd-input"
                value={fActor}
                onChange={(e) => setFActor(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
                placeholder="예: 0908033"
                style={{ width: 130 }}
              />
            </label>
            <label style={filterLabel}>
              시작일
              <input className="sd-input" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
            </label>
            <label style={filterLabel}>
              종료일
              <input className="sd-input" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="sd-btn sd-btn-primary sd-btn-sm" onClick={apply} disabled={loading}>
                조회
              </button>
              <button className="sd-btn sd-btn-ghost sd-btn-sm" onClick={resetFilters} disabled={loading}>
                초기화
              </button>
            </div>
          </div>
        </div>

        {/* 결과 테이블 */}
        <div className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>
              전체 {total.toLocaleString()}건{total > 0 ? ` · ${from.toLocaleString()}–${to.toLocaleString()}` : ''}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="sd-btn sd-btn-outline sd-btn-xs" disabled={!canPrev || loading} onClick={() => void load(Math.max(offset - PAGE_SIZE, 0))}>
                이전
              </button>
              <button className="sd-btn sd-btn-outline sd-btn-xs" disabled={!canNext || loading} onClick={() => void load(offset + PAGE_SIZE)}>
                다음
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ color: 'var(--fg-muted)', padding: 24 }}>불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', padding: 24 }}>해당하는 감사 로그가 없습니다.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-body)' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={th}>시각</th>
                    <th style={th}>유형</th>
                    <th style={th}>행위자</th>
                    <th style={th}>대상</th>
                    <th style={th}>변경 내용 (이전 → 이후)</th>
                    <th style={th}>사유</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const diff = buildDiff(r.previous_value, r.new_value);
                    return (
                      <tr key={r.id}>
                        <td style={{ ...td, color: 'var(--fg-muted)' }}>{fmtDateTime(r.created_at)}</td>
                        <td style={td}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 10px',
                              borderRadius: 999,
                              fontSize: 'var(--fs-xs)',
                              fontWeight: 700,
                              background: 'var(--ok-orange-50)',
                              color: 'var(--ok-brown)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {actionLabel(r.action_type)}
                          </span>
                        </td>
                        <td style={td}>
                          <strong>{r.actor_name ?? r.actor_id ?? '-'}</strong>
                          {r.actor_id && (
                            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontFamily: 'monospace' }}>{r.actor_id}</div>
                          )}
                        </td>
                        <td style={td}>
                          <strong>{r.target_employee_name ?? r.target_employee_id ?? '-'}</strong>
                          {r.target_employee_id && (
                            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontFamily: 'monospace' }}>
                              {r.target_employee_id}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, whiteSpace: 'normal', minWidth: 280, maxWidth: 460 }}>
                          {diff.length === 0 ? (
                            <span style={{ color: 'var(--fg-subtle)' }}>—</span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              {diff.map((line, i) => (
                                <div key={`${line.key}-${i}`} style={{ fontSize: 'var(--fs-sm)' }}>
                                  {line.key && (
                                    <span style={{ fontWeight: 700, color: 'var(--fg-muted)' }}>{fieldLabel(line.key)}: </span>
                                  )}
                                  <span style={{ color: 'var(--fg-muted)', textDecoration: 'line-through' }} title={line.before}>
                                    {truncate(line.before)}
                                  </span>
                                  <span style={{ color: 'var(--fg-subtle)' }}> → </span>
                                  <span style={{ fontWeight: 600 }} title={line.after}>
                                    {truncate(line.after)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, whiteSpace: 'normal', maxWidth: 260, color: 'var(--fg-muted)' }} title={r.reason ?? ''}>
                          {r.reason ?? '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const filterLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 'var(--fs-sm)',
  fontWeight: 700,
  color: 'var(--fg-muted)',
};

const th: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 700,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '12px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
  whiteSpace: 'nowrap',
};

export default HrAuditLogPage;
