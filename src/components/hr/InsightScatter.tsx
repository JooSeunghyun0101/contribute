import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Download } from 'lucide-react';
import { HR_COLOR } from '@/components/Dashboard/HrDashboardCharts';
import { downloadInsightWorkbook } from '@/utils/insightExport';
import {
  buildScatterPoints,
  levelMeanScores,
  reviewPriority,
  type ScatterAxis,
  type ScatterPoint,
  type OrgScatterLevel,
} from '@/lib/insightScatter';
import { ORG_LEVEL_LABELS } from '@/lib/orgHierarchy';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

const ORG_LEVELS: OrgScatterLevel[] = ['division', 'department', 'team'];

const COLOR_HIGH = HR_COLOR.achieved; // 상위(레벨평균보다 높음)
const COLOR_LOW = HR_COLOR.blue; // 하위(레벨평균보다 낮음)
const COLOR_MID = HR_COLOR.pending; // 중간

const variWord = (sd: number | null): string =>
  sd == null ? '표본 부족' : sd < 0.3 ? '거의 차등 없음(쏠림)' : sd < 0.7 ? '차등 적음' : '차등 뚜렷';

const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
};

const niceStep = (range: number): number => {
  const raw = (range || 1) / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const s = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return s * mag;
};
const ticksFor = (min: number, max: number): number[] => {
  const step = niceStep(max - min);
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};

const H = 380;
const M = { L: 56, R: 16, T: 14, B: 48 };

type PlotPoint = ScatterPoint & { y: number };

type Props = {
  records: EmployeeEvaluationRecord[];
  cohortRecords?: EmployeeEvaluationRecord[];
  axis: ScatterAxis;
  onSelect: (point: ScatterPoint) => void;
  periodLabel?: string | null;
};

const InsightScatter = ({ records, cohortRecords, axis, onSelect, periodLabel }: Props) => {
  const [orgLevel, setOrgLevel] = useState<OrgScatterLevel>('division');
  const points = useMemo(
    () => buildScatterPoints(records, axis, orgLevel, cohortRecords),
    [records, axis, orgLevel, cohortRecords],
  );
  const label = axis === 'org' ? ORG_LEVEL_LABELS[orgLevel] : axis === 'job' ? '직종' : '평가자';
  const levelMeans = useMemo(() => levelMeanScores(cohortRecords ?? records), [cohortRecords, records]);

  const nonSmall = useMemo(() => points.filter((p) => !p.isSmall), [points]);
  const smallCount = points.length - nonSmall.length;

  const { q25, q75 } = useMemo(() => {
    const sorted = nonSmall.map((p) => p.bias).sort((a, b) => a - b);
    return { q25: quantile(sorted, 0.25), q75: quantile(sorted, 0.75) };
  }, [nonSmall]);
  const colorOf = (bias: number): string => {
    if (nonSmall.length < 4) return bias >= 0.3 ? COLOR_HIGH : bias <= -0.3 ? COLOR_LOW : COLOR_MID;
    if (bias >= q75) return COLOR_HIGH;
    if (bias <= q25) return COLOR_LOW;
    return COLOR_MID;
  };

  const ranked = useMemo(() => [...nonSmall].sort((a, b) => reviewPriority(b) - reviewPriority(a)), [nonSmall]);

  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const list = useMemo(
    () => (selectedIds ? ranked.filter((p) => selectedIds.has(p.id)) : ranked),
    [ranked, selectedIds],
  );

  // 선택/하이라이트 점은 맨 뒤(맨 앞 레이어)에 그려 가려지지 않게.
  const plotted = useMemo<PlotPoint[]>(() => {
    const arr: PlotPoint[] = nonSmall.map((p) => ({ ...p, y: p.stdDev ?? 0 }));
    arr.sort((a, b) => {
      const aSel = (selectedIds?.has(a.id) ? 1 : 0) + (a.id === highlightId ? 1 : 0);
      const bSel = (selectedIds?.has(b.id) ? 1 : 0) + (b.id === highlightId ? 1 : 0);
      return aSel - bSel;
    });
    return arr;
  }, [nonSmall, selectedIds, highlightId]);

  // 분포 비례 상대 여백(좌·하 더 크게) — 점을 넓게 펼치고 가장자리도 드래그로 잡히게.
  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    if (plotted.length === 0) return { xMin: -1, xMax: 1, yMin: 0, yMax: 1 };
    const xs = plotted.map((p) => p.bias);
    const ys = plotted.map((p) => p.y);
    const xLo = Math.min(0, ...xs);
    const xHi = Math.max(0, ...xs);
    const yLo = Math.min(...ys);
    const yHi = Math.max(...ys);
    const xs2 = (xHi - xLo) || 1;
    const ys2 = (yHi - yLo) || 1;
    return { xMin: xLo - xs2 * 0.16, xMax: xHi + xs2 * 0.08, yMin: yLo - ys2 * 0.16, yMax: yHi + ys2 * 0.08 };
  }, [plotted]);

  // 너비 측정.
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(680);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = Math.max(10, width - M.L - M.R);
  const plotH = H - M.T - M.B;
  const sx = (b: number) => M.L + ((b - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (y: number) => M.T + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;
  const ns = plotted.map((p) => p.n);
  const nMin = ns.length ? Math.min(...ns) : 0;
  const nMax = ns.length ? Math.max(...ns) : 1;
  const sr = (n: number) => {
    if (nMax === nMin) return 8;
    const t = (Math.sqrt(n) - Math.sqrt(nMin)) / (Math.sqrt(nMax) - Math.sqrt(nMin));
    return 5 + t * 11;
  };

  // 상호작용 상태.
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [hover, setHover] = useState<{ p: PlotPoint; left: number; top: number } | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const movedRef = useRef(false);
  const justPickedRef = useRef(false);
  const ctrlRef = useRef(false);

  const pick = (p: ScatterPoint, ctrl: boolean) => {
    justPickedRef.current = true;
    if (ctrl) {
      const next = new Set(selectedIds ?? []);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      setSelectedIds(next.size > 0 ? next : null);
      setHighlightId(next.has(p.id) ? p.id : null);
    } else {
      setSelectedIds(new Set([p.id]));
      setHighlightId(p.id);
    }
  };

  const finishDrag = () => {
    const d = dragRef.current;
    if (movedRef.current && d) {
      const minX = Math.min(d.x0, d.x1);
      const maxX = Math.max(d.x0, d.x1);
      const minY = Math.min(d.y0, d.y1);
      const maxY = Math.max(d.y0, d.y1);
      const inBox = plotted.filter((p) => {
        const cx = sx(p.bias);
        const cy = sy(p.y);
        return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
      });
      const ctrl = ctrlRef.current;
      setSelectedIds((prev) => {
        const ids = new Set(inBox.map((p) => p.id));
        if (ctrl && prev) for (const id of prev) ids.add(id);
        return ids.size > 0 ? ids : null;
      });
      setHighlightId(null);
    } else {
      // 클릭: 점을 눌렀으면 circle onClick 이 처리. 아니면(빈 영역) 해제.
      setTimeout(() => {
        if (!justPickedRef.current) {
          setSelectedIds(null);
          setHighlightId(null);
        }
        justPickedRef.current = false;
      }, 0);
    }
    downRef.current = null;
    dragRef.current = null;
    movedRef.current = false;
    setDrag(null);
  };

  // 드래그는 window 로 추적 — 커서가 SVG(차트)를 벗어나 카드 끝까지 가도 박스가 따라가고
  // 가장자리 점도 잡힌다.
  const onSvgMouseDown = (e: ReactMouseEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    downRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    ctrlRef.current = e.ctrlKey || e.metaKey;
    movedRef.current = false;
    setHover(null);
    const move = (ev: MouseEvent) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r || !downRef.current) return;
      const cur = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      if (Math.hypot(cur.x - downRef.current.x, cur.y - downRef.current.y) > 6) movedRef.current = true;
      if (movedRef.current) {
        dragRef.current = { x0: downRef.current.x, y0: downRef.current.y, x1: cur.x, y1: cur.y };
        setDrag(dragRef.current);
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      finishDrag();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onRowClick = (p: ScatterPoint, e: ReactMouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+행 = 다중 선택 토글.
      const next = new Set(selectedIds ?? []);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      setSelectedIds(next.size > 0 ? next : null);
      setHighlightId(next.has(p.id) ? p.id : null);
    } else {
      // 일반 행 클릭 = 그래프에서 해당 점 강조만(대상자 팝업은 '상세' 버튼으로).
      setHighlightId(p.id);
    }
  };

  const xTicks = useMemo(() => ticksFor(xMin, xMax), [xMin, xMax]);
  const yTicks = useMemo(() => ticksFor(yMin, yMax), [yMin, yMax]);
  const zeroIn = xMin <= 0 && xMax >= 0;

  return (
    <section className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>{label} 점수 경향 · 변별력</h2>
            {axis === 'org' && (
              <select
                className="sd-input"
                value={orgLevel}
                onChange={(e) => setOrgLevel(e.target.value as OrgScatterLevel)}
                style={{ height: 28, padding: '0 8px', fontSize: 'var(--fs-xs)', fontWeight: 700, width: 'auto' }}
                aria-label="집계 단위"
              >
                {ORG_LEVELS.map((lv) => (
                  <option key={lv} value={lv}>{ORG_LEVEL_LABELS[lv]} 단위</option>
                ))}
              </select>
            )}
          </div>
          <button
            type="button"
            className="sd-btn sd-btn-outline sd-btn-sm"
            onClick={() => downloadInsightWorkbook(label, points, records, periodLabel)}
            disabled={points.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Download size={14} />
            데이터 다운로드
          </button>
        </div>

        {levelMeans.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 'var(--fs-sm)' }}>
            <span style={{ fontWeight: 800, color: 'var(--fg-muted)' }}>레벨평균 점수</span>
            {levelMeans.map((l) => (
              <span key={l.level} className="tnum" style={{ color: 'var(--fg)' }}>
                Lv.{l.level} <b style={{ color: 'var(--ok-orange)' }}>{l.mean.toFixed(1)}</b>
                <span style={{ color: 'var(--fg-subtle)' }}> ({l.n}명)</span>
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
            가로: 레벨평균보다 점수 높음(오른쪽)·낮음(왼쪽) · 세로: 사람별 차등 · 점 크기: 인원 ·
            쏠림: 한 평가결과(초과/충족/근접/미달)에 몰린 비율(높을수록 변별 없음) · 클릭·드래그(Ctrl=다중)
          </span>
          <div style={{ display: 'flex', gap: 12, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
            <Legend color={COLOR_LOW} text="하위 25%(낮음)" />
            <Legend color={COLOR_MID} text="중간" />
            <Legend color={COLOR_HIGH} text="상위 25%(높음)" />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 0 }}>
        <div ref={wrapRef} style={{ position: 'relative', width: '100%', userSelect: 'none', WebkitUserSelect: 'none' }}>
          {plotted.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--fg-muted)' }}>표본이 충분한(n≥5) 그룹이 없습니다.</div>
          ) : (
            <svg
              ref={svgRef}
              width={width}
              height={H}
              style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
              onMouseDown={onSvgMouseDown}
              onMouseLeave={() => setHover(null)}
              onDragStart={(e) => e.preventDefault()}
            >
              {/* y grid + ticks */}
              {yTicks.map((t) => (
                <g key={`y${t}`}>
                  <line x1={M.L} x2={width - M.R} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeDasharray="3 3" />
                  <text x={M.L - 8} y={sy(t)} textAnchor="end" dominantBaseline="central" fontSize={13} fill="var(--fg-muted)">
                    {t.toFixed(1)}
                  </text>
                </g>
              ))}
              {/* x ticks */}
              {xTicks.map((t) => (
                <g key={`x${t}`}>
                  <line x1={sx(t)} x2={sx(t)} y1={M.T} y2={M.T + plotH} stroke="var(--border)" strokeDasharray="3 3" />
                  <text x={sx(t)} y={M.T + plotH + 18} textAnchor="middle" fontSize={13} fill="var(--fg-muted)">
                    {t.toFixed(1)}
                  </text>
                </g>
              ))}
              {/* 축 실선 — y축(왼쪽)·x축(아래) 구분선 */}
              <line x1={M.L} x2={M.L} y1={M.T} y2={M.T + plotH} stroke="var(--fg-muted)" strokeWidth={1.5} />
              <line x1={M.L} x2={width - M.R} y1={M.T + plotH} y2={M.T + plotH} stroke="var(--fg-muted)" strokeWidth={1.5} />
              {/* x=0 기준선 */}
              {zeroIn && <line x1={sx(0)} x2={sx(0)} y1={M.T} y2={M.T + plotH} stroke={HR_COLOR.orange} strokeDasharray="4 2" strokeWidth={1.5} />}
              {/* 축 제목 */}
              <text x={M.L + plotW / 2} y={H - 6} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--fg)">
                레벨평균 대비  (← 낮음 · 0 비슷 · 높음 →)
              </text>
              <text x={14} y={M.T + plotH / 2} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--fg)" transform={`rotate(-90, 14, ${M.T + plotH / 2})`}>
                변별력 ↑
              </text>
              {/* 드래그 박스 */}
              {drag && (
                <rect
                  x={Math.min(drag.x0, drag.x1)}
                  y={Math.min(drag.y0, drag.y1)}
                  width={Math.abs(drag.x1 - drag.x0)}
                  height={Math.abs(drag.y1 - drag.y0)}
                  fill={HR_COLOR.orange}
                  fillOpacity={0.12}
                  stroke={HR_COLOR.orange}
                />
              )}
              {/* 점 — 선택은 바깥 헤일로 링으로 또렷하게(검은 굵은선 대신). */}
              {plotted.map((p) => {
                const dimmed = selectedIds != null && !selectedIds.has(p.id);
                const isHi = p.id === highlightId;
                const selected = !!selectedIds?.has(p.id);
                const cx = sx(p.bias);
                const cy = sy(p.y);
                const r = sr(p.n);
                return (
                  <g
                    key={p.id}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => {
                      if (drag) return;
                      const r = svgRef.current?.getBoundingClientRect();
                      setHover({ p, left: (r?.left ?? 0) + cx, top: (r?.top ?? 0) + cy });
                    }}
                    onMouseLeave={() => setHover(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      pick(p, e.ctrlKey || e.metaKey);
                    }}
                  >
                    {/* 개별 강조(단일 클릭·행 선택)만 헤일로 링. 그룹(다중) 선택은 흐림 대비로 구분. */}
                    {isHi && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r + 8}
                        fill="none"
                        stroke={HR_COLOR.orange}
                        strokeWidth={3.5}
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={colorOf(p.bias)}
                      fillOpacity={dimmed ? 0.12 : 0.88}
                      stroke={selected ? 'var(--fg)' : '#fff'}
                      strokeWidth={dimmed ? 0 : selected ? 2 : 1}
                    />
                  </g>
                );
              })}
            </svg>
          )}

          {/* 툴팁 — body 로 포털해 카드 overflow 에 안 잘리고 항상 맨 앞에. */}
          {hover && !drag &&
            createPortal(
              <div
                style={{
                  position: 'fixed',
                  left: Math.min(hover.left + 14, window.innerWidth - 230),
                  top: Math.max(hover.top - 10, 8),
                  pointerEvents: 'none',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  fontSize: 'var(--fs-sm)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                  width: 214,
                  zIndex: 9999,
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 6 }}>
                  {label} · {hover.p.label} <span style={{ color: 'var(--fg-muted)', fontWeight: 600 }}>{hover.p.n}명</span>
                </div>
                <Row label="평균대비" value={`${hover.p.bias >= 0 ? '+' : ''}${hover.p.bias.toFixed(2)}`} sub={`평균점수 ${hover.p.meanScore.toFixed(2)}`} color={colorOf(hover.p.bias)} />
                <Row label="변별 정도" value={variWord(hover.p.stdDev)} sub={hover.p.stdDev == null ? '' : `편차 ${hover.p.stdDev.toFixed(2)}`} />
                <Row label="쏠림" value={`${Math.round(hover.p.modeShare * 100)}% ‘${hover.p.modeLabel}’`} />
              </div>,
              document.body,
            )}
        </div>

        {/* 전체 그룹 목록 */}
        <div style={{ borderLeft: '1px solid var(--border)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div className="sd-label-mini">
              {selectedIds ? `선택한 ${list.length}개` : `${label} 전체 ${list.length}개`} · 검토 권장 순
            </div>
            {selectedIds && (
              <button
                type="button"
                onClick={() => {
                  setSelectedIds(null);
                  setHighlightId(null);
                }}
                style={{ border: 'none', background: 'none', color: 'var(--ok-orange)', fontWeight: 700, fontSize: 'var(--fs-xs)', cursor: 'pointer' }}
              >
                선택 해제
              </button>
            )}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>행 클릭=그래프 점 강조 · 상세=대상자 보기 · Ctrl+클릭=다중 선택</div>
          {list.length === 0 ? (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>해당하는 그룹이 없습니다.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', maxHeight: 300, paddingRight: 4 }}>
              {list.map((p) => (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => onRowClick(p, e)}
                  title={`${p.label} · ${variWord(p.stdDev)} · 쏠림 ${Math.round(p.modeShare * 100)}%`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    borderLeft: `3px solid ${colorOf(p.bias)}`,
                    background: p.id === highlightId ? 'var(--ok-orange-50)' : 'var(--bg-card)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700, fontSize: 'var(--fs-sm)' }} title={p.label}>
                    {p.label}
                  </span>
                  <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                    <span className="tnum" style={{ color: colorOf(p.bias), fontWeight: 800 }}>
                      평균대비 {p.bias >= 0 ? '+' : ''}{p.bias.toFixed(1)}
                    </span>
                    <span className="tnum">쏠림 {Math.round(p.modeShare * 100)}%</span>
                    <span className="tnum">{p.n}명</span>
                    <button
                      type="button"
                      className="sd-btn sd-btn-outline sd-btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHighlightId(p.id);
                        onSelect(p);
                      }}
                      style={{ padding: '2px 8px', fontSize: 'var(--fs-xs)' }}
                    >
                      상세
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {smallCount > 0 && (
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-subtle)' }}>
              표본 부족(n&lt;5) {smallCount}개 {label}는 제외(다운로드에는 포함).
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const Row = ({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', lineHeight: 1.6 }}>
    <span style={{ width: 56, flexShrink: 0, color: 'var(--fg-subtle)', fontSize: 'var(--fs-xs)' }}>{label}</span>
    <span style={{ fontWeight: 700, color: color ?? 'var(--fg)' }}>{value}</span>
    {sub && <span className="tnum" style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-xs)' }}>{sub}</span>}
  </div>
);

const Legend = ({ color, text }: { color: string; text: string }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
    <span style={{ width: 10, height: 10, borderRadius: 999, background: color, display: 'inline-block' }} />
    {text}
  </span>
);

export default InsightScatter;
