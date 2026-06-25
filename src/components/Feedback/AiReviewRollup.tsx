import { Fragment, useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pill } from '@/components/brand';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { aiReviewService, evaluationService, type AiReviewRollup as Rollup } from '@/lib/services';

// AI가 '구체성 부족'처럼 변형 문자열로 답해도 표준 4개로 흡수(아니면 '기타').
const canonType = (raw: string | null): string => {
  const t = (raw ?? '').trim();
  if (!t) return '기타';
  if (/복붙|복사|유사|중복|동일|표절|베낌|붙여넣/.test(t)) return '복붙';
  if (/논조|어조|톤|점수|갭|모순|불일치|정합|일치|칭찬|질책/.test(t)) return '논조';
  if (/성의|성실|영혼|무관|무의미|의미\s*없|관련\s*없|반복|자모/.test(t)) return '성의';
  if (/구체|추상|모호|일반론|두루뭉/.test(t)) return '구체성';
  return '기타';
};

// 표시용 공식 라벨 — 저장값(구어체: 성의·복붙·논조)은 그대로 두고 화면에만 공식 표기로 매핑.
const TYPE_LABEL: Record<string, string> = { 구체성: '구체성', 성의: '성실성', 복붙: '중복성', 논조: '정합성' };
const typeLabel = (t: string): string => TYPE_LABEL[t] ?? t;

// 유형별 칩 색.
const typeTone = (type: string | null): 'warning' | 'orange' | 'info' | 'neutral' => {
  switch (canonType(type)) {
    case '복붙':
      return 'orange';
    case '논조':
      return 'info';
    case '성의':
      return 'warning';
    case '구체성':
      return 'warning';
    default:
      return 'neutral';
  }
};

// HR AI검수 롤업 — 평가자가 저장 시 쌓아둔 1차 검수 결과만 읽어 보여준다(여기서 AI 재호출 없음).
// 평가자가 부적합 알림 후 고쳐서 통과하면 자동으로 '이상없음'으로 갱신되어 여기서 빠진다.
export const AiReviewRollup = () => {
  const { selectedPeriodId } = useEvaluationPeriod();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<Rollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ ev: string; type: string } | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    aiReviewService
      .getRollup(selectedPeriodId)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch(() => {
        if (!cancelled) setError('AI 검수 현황을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPeriodId]);

  const unreviewed = data ? Math.max(0, data.total - data.reviewed) : 0;

  // 평가자별 재검토 요청 — 그 평가자의 부적합 평가(evaluation_id 중복제거)마다 HR 재검토 요청 알림 발송.
  const handleRequestReview = async (evName: string, items: Rollup['items']) => {
    const evalIds = [...new Set(items.map((i) => i.evaluation_id).filter(Boolean))];
    if (evalIds.length === 0) return;
    if (!user?.employeeId) {
      toast({ title: '로그인이 필요합니다.', variant: 'destructive' });
      return;
    }
    if (!window.confirm(`${evName} 평가자에게 AI 검수 부적합 ${evalIds.length}건의 재검토를 요청할까요?`)) {
      return;
    }
    setSending(evName);
    try {
      let ok = 0;
      for (const id of evalIds) {
        try {
          await evaluationService.requestReturn(id, {
            requestedBy: user.employeeId,
            reason: 'AI 검수에서 부적합으로 표시된 평가의견 재검토 요청',
            origin: 'hr',
          });
          ok += 1;
        } catch {
          /* 개별 실패는 건너뛰고 나머지 계속 */
        }
      }
      toast({
        title: '재검토 요청을 보냈습니다.',
        description: `${evName} 평가자에게 ${ok}건의 HR 재검토 요청 알림이 전달되었습니다. (평가 상태 변경 없음)`,
      });
    } finally {
      setSending(null);
    }
  };

  return (
    <section className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>AI 피드백 검수 현황</h2>
        <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
          평가자가 평가 저장 시 1차로 검수한 결과만 모아 봅니다. 부적합 항목은 평가자가 고쳐 통과하면 자동으로 빠집니다.
          (여기서 AI를 다시 돌리지 않습니다)
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 20, color: 'var(--fg-muted)' }}>불러오는 중…</div>
      ) : error ? (
        <div style={{ padding: 20, color: 'var(--danger)' }}>{error}</div>
      ) : !data ? null : (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* 요약 스트립 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap' }}>
            <Stat label="피드백 항목" value={`${data.total}건`} />
            <Divider />
            <Stat label="검수 완료" value={`${data.reviewed}건`} />
            <Divider />
            <Stat label="미검수" value={`${unreviewed}건`} sub="저장 전/구 평가" />
            <Divider />
            <Stat label="부적합 플래그" value={`${data.flagged}건`} accent={data.flagged > 0} />
          </div>

          {/* 평가자 × 사유 종류 매트릭스 */}
          <div>
            <div className="sd-label-mini" style={{ marginBottom: 8 }}>
              평가자별 부적합 (사유 종류) {data.flagged > 0 ? `· 총 ${data.flagged}건` : ''}
            </div>
            {data.items.length === 0 ? (
              <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)', padding: '8px 0' }}>
                부적합으로 표시된 피드백이 없습니다.
              </div>
            ) : (
              (() => {
                const ORDER = ['구체성', '성의', '복붙', '논조'];
                const norm = canonType;
                const map = new Map<string, { ev: string; counts: Record<string, number>; total: number; items: typeof data.items }>();
                for (const it of data.items) {
                  const ev = it.evaluator_name || '미상';
                  let r = map.get(ev);
                  if (!r) {
                    r = { ev, counts: {}, total: 0, items: [] };
                    map.set(ev, r);
                  }
                  const t = norm(it.ai_type);
                  r.counts[t] = (r.counts[t] || 0) + 1;
                  r.total += 1;
                  r.items.push(it);
                }
                const rows = [...map.values()].sort((a, b) => b.total - a.total);
                const hasEtc = rows.some((r) => r.counts['기타']);
                const cols = [...ORDER, ...(hasEtc ? ['기타'] : [])];
                const colCount = cols.length + 2; // 평가자 + 사유 컬럼들 + 합계
                const cellBtn = (active: boolean): CSSProperties => ({
                  minWidth: 30,
                  padding: '2px 8px',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: active ? 900 : 700,
                  color: active ? '#fff' : 'var(--fg)',
                  background: active ? 'var(--ok-orange)' : 'var(--bg-muted)',
                });
                return (
                  <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    <Table>
                      <TableHeader style={{ background: 'var(--bg-muted)' }}>
                        <TableRow>
                          <TableHead style={{ whiteSpace: 'nowrap' }}>평가자</TableHead>
                          {cols.map((c) => (
                            <TableHead key={c} style={{ textAlign: 'center' }}>{typeLabel(c)}</TableHead>
                          ))}
                          <TableHead style={{ textAlign: 'center' }}>합계</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r) => {
                          const expanded = selected?.ev === r.ev;
                          const detail = expanded
                            ? r.items.filter((it) => selected!.type === '합계' || norm(it.ai_type) === selected!.type)
                            : [];
                          const distinctEvals = new Set(r.items.map((i) => i.evaluation_id).filter(Boolean)).size;
                          return (
                            <Fragment key={r.ev}>
                              <TableRow>
                                <TableCell style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{r.ev}</TableCell>
                                {cols.map((c) => {
                                  const n = r.counts[c] || 0;
                                  const active = selected?.ev === r.ev && selected?.type === c;
                                  return (
                                    <TableCell key={c} style={{ textAlign: 'center' }}>
                                      {n > 0 ? (
                                        <button type="button" className="tnum" style={cellBtn(active)} onClick={() => setSelected(active ? null : { ev: r.ev, type: c })}>
                                          {n}
                                        </button>
                                      ) : (
                                        <span style={{ color: 'var(--fg-subtle)' }}>·</span>
                                      )}
                                    </TableCell>
                                  );
                                })}
                                <TableCell style={{ textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    className="tnum"
                                    style={cellBtn(selected?.ev === r.ev && selected?.type === '합계')}
                                    onClick={() => setSelected(selected?.ev === r.ev && selected?.type === '합계' ? null : { ev: r.ev, type: '합계' })}
                                  >
                                    {r.total}
                                  </button>
                                </TableCell>
                              </TableRow>

                              {/* 갯수 클릭 시 해당 평가자 행 바로 아래로 상세가 펼쳐진다(인라인). */}
                              {expanded && (
                                <TableRow>
                                  <TableCell colSpan={colCount} style={{ padding: 0, background: 'var(--bg-subtle)' }}>
                                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                      <span style={{ fontWeight: 800 }}>
                                        {r.ev} · {typeLabel(selected!.type)}{' '}
                                        <span style={{ color: 'var(--fg-muted)', fontWeight: 600 }}>{detail.length}건</span>
                                      </span>
                                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <button
                                          type="button"
                                          onClick={() => handleRequestReview(r.ev, r.items)}
                                          disabled={sending === r.ev || distinctEvals === 0}
                                          style={{
                                            border: 'none',
                                            background: 'var(--ok-orange)',
                                            color: '#fff',
                                            fontWeight: 800,
                                            cursor: sending === r.ev ? 'default' : 'pointer',
                                            opacity: sending === r.ev ? 0.6 : 1,
                                            padding: '5px 12px',
                                            borderRadius: 7,
                                            fontSize: 'var(--fs-xs)',
                                          }}
                                          title="이 평가자의 부적합 평가에 대해 HR 재검토 요청 알림을 보냅니다(상태 변경 없음)."
                                        >
                                          {sending === r.ev ? '발송 중…' : `재검토 요청 (${distinctEvals}건)`}
                                        </button>
                                        <button type="button" onClick={() => setSelected(null)} style={{ border: 'none', background: 'none', color: 'var(--ok-orange)', fontWeight: 700, cursor: 'pointer' }}>
                                          닫기
                                        </button>
                                      </span>
                                    </div>
                                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                                      {detail.map((it, idx) => (
                                        <button
                                          key={`${it.evaluation_id}-${idx}`}
                                          type="button"
                                          onClick={() => navigate(`/hr/evaluation-viewer?evaluatee=${encodeURIComponent(it.evaluatee_id)}`)}
                                          title="평가 열람"
                                          style={{ width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', padding: '10px 12px', cursor: 'pointer' }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontWeight: 800 }}>{it.evaluatee_name}</span>
                                            {it.ai_type && <Pill tone={typeTone(it.ai_type)}>{typeLabel(canonType(it.ai_type))}</Pill>}
                                            {it.task_title && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>· {it.task_title}</span>}
                                          </div>
                                          {it.ai_summary && (
                                            <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>{it.ai_summary}</div>
                                          )}
                                        </button>
                                      ))}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}
    </section>
  );
};

const Stat = ({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--fg-muted)' }}>{label}</span>
    <span className="tnum" style={{ fontSize: 'var(--fs-h3)', fontWeight: 900, lineHeight: 1, color: accent ? 'var(--ok-orange)' : 'var(--fg)' }}>
      {value}
    </span>
    {sub && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>{sub}</span>}
  </div>
);

const Divider = () => <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', minHeight: 28 }} />;

export default AiReviewRollup;
