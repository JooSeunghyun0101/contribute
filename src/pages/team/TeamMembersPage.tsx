import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import PageHeader from '@/components/Layout/PageHeader';
import { ErrorState, LoadingState } from '@/components/ui/state-views';
import { evaluationStatusLabel } from '@/lib/evaluationStatus';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import {
  useTeamDashboardRecords,
  useFormerTeamDashboardRecords,
  useEvaluationLineRecords,
} from '@/hooks/useDashboardRecords';
import { employeeService } from '@/lib/services';
import { formatScore, getScoreColor, MATRIX_SCORE_COLORS } from '@/lib/evaluationMatrix';
import OrgChecklist from '@/components/hr/OrgChecklist';
import { getOrgValue, matchesOrgNodes, orgFieldsFromEvaluation } from '@/lib/orgHierarchy';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

const COLOR_ACHIEVED = MATRIX_SCORE_COLORS[4];
const COLOR_MISSED = 'var(--score-2-bg)';
const COLOR_PENDING = MATRIX_SCORE_COLORS[1];
const LEVEL_LEGEND: { color: string; label: string }[] = [
  { color: COLOR_ACHIEVED, label: '달성' },
  { color: COLOR_MISSED, label: '미달성' },
  { color: COLOR_PENDING, label: '미완료' },
];

type Relation = 'direct' | 'line';
type Row = { record: EmployeeEvaluationRecord; relation: Relation };
type LevelStat = { level: number; label: string; total: number; achieved: number; missed: number; pending: number };

// 팀원 org 는 그 평가기간 기준(evaluatee_org_*) → 없으면 현재 employee.org_* 폴백.
const recordOrg = (record: EmployeeEvaluationRecord) =>
  orgFieldsFromEvaluation(record.evaluation, record.employee);

const formatWorkDate = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

type StatusInfo = { label: string; color: string };
const statusOf = (r: EmployeeEvaluationRecord): StatusInfo => {
  const completed = r.reviewStatus === 'completed' || r.reviewStatus === 'locked';
  if (completed) {
    return r.achieved
      ? { label: '달성', color: 'var(--score-4-bg)' }
      : { label: '미달성', color: 'var(--score-2-bg)' };
  }
  // '검토 대기'·'평가 중' 라벨은 SSOT 에서(드리프트 방지). 그 외는 이 화면 관점의 '미제출'.
  const label =
    r.reviewStatus === 'submitted' || r.reviewStatus === 'evaluating'
      ? evaluationStatusLabel(r.reviewStatus)
      : '미제출';
  return { label, color: 'var(--fg-muted)' };
};

const th: CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 'var(--fs-xs)',
  fontWeight: 800,
  letterSpacing: '0.04em',
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  background: 'var(--bg-card)',
  borderBottom: '1px solid var(--border)',
};
const td: CSSProperties = { padding: '9px 12px', whiteSpace: 'nowrap', verticalAlign: 'middle' };

const RelationChip = ({ relation }: { relation: Relation }) => {
  const direct = relation === 'direct';
  return (
    <span
      style={{
        padding: '2px 9px',
        borderRadius: 999,
        fontSize: 'var(--fs-2xs)',
        fontWeight: 800,
        letterSpacing: '0.03em',
        background: direct ? 'var(--ok-orange-50)' : 'var(--bg-muted)',
        color: direct ? 'var(--ok-orange-700)' : 'var(--fg-muted)',
        border: `1px solid ${direct ? 'var(--ok-orange-100)' : 'var(--border)'}`,
        whiteSpace: 'nowrap',
      }}
    >
      {direct ? '담당' : '열람'}
    </span>
  );
};

const TeamMembersPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { selectedPeriod } = useEvaluationPeriod();
  const evaluatorId = user?.employeeId || '';
  const periodId = selectedPeriod?.id ?? null;
  const periodYear = selectedPeriod?.evaluation_year ?? null;

  const { records: allRecords, isLoading, error, reload } = useTeamDashboardRecords(evaluatorId);
  const { records: formerRecords } = useFormerTeamDashboardRecords(evaluatorId);
  const { records: lineRecords, isLoading: lineLoading } = useEvaluationLineRecords(evaluatorId);

  // 담당 = 선택 기간 평가의 배정 평가자가 본인인 레코드(기간 정확성 위해 현재+이전 발령 병합 후 필터).
  const directRecords = useMemo(() => {
    const map = new Map<string, EmployeeEvaluationRecord>();
    for (const r of allRecords) map.set(r.employee.employee_id, r);
    for (const r of formerRecords) if (!map.has(r.employee.employee_id)) map.set(r.employee.employee_id, r);
    return [...map.values()].filter((r) => String(r.evaluation?.evaluator_id ?? '') === evaluatorId);
  }, [allRecords, formerRecords, evaluatorId]);

  // 담당(직접) + 라인 하위(열람) 통합. 중복 사번은 담당 우선.
  // 라인 하위는 '선택한 평가기간에 평가가 있는 사람'만 — 그 기간에 배정/평가가 없는
  // (예: 다음 연도에만 배정된) 인원이 지난 기간 조회에 섞이지 않게 한다.
  const rows = useMemo(() => {
    const byId = new Map<string, Row>();
    for (const r of directRecords) byId.set(r.employee.employee_id, { record: r, relation: 'direct' });
    for (const r of lineRecords)
      if (r.evaluation != null && !byId.has(r.employee.employee_id))
        byId.set(r.employee.employee_id, { record: r, relation: 'line' });
    return [...byId.values()];
  }, [directRecords, lineRecords]);

  // 근무기간 시작(내 체인 산입일) 맵.
  const [sinceMap, setSinceMap] = useState<Map<string, string | null>>(new Map());
  useEffect(() => {
    if (!evaluatorId) {
      setSinceMap(new Map());
      return;
    }
    let cancelled = false;
    employeeService
      .getTeamRosterSince(evaluatorId, periodId, periodYear)
      .then((list) => {
        if (!cancelled) setSinceMap(new Map(list.map((x) => [x.employee_id, x.chain_since])));
      })
      .catch(() => {
        if (!cancelled) setSinceMap(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [evaluatorId, periodId, periodYear]);

  const [selectedLevel, setSelectedLevel] = useState<number | 'all'>('all');
  const [relationFilter, setRelationFilter] = useState<'all' | Relation>('all');
  const [orgFilter, setOrgFilter] = useState<string[]>([]);

  const growthLevels = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.record.employee.growth_level ?? 1))).sort((a, b) => b - a),
    [rows],
  );

  const visibleRows = useMemo(() => {
    return rows
      .filter((row) => {
        if (selectedLevel !== 'all' && (row.record.employee.growth_level ?? 1) !== selectedLevel) return false;
        if (relationFilter !== 'all' && row.relation !== relationFilter) return false;
        if (!matchesOrgNodes(recordOrg(row.record), orgFilter)) return false;
        return true;
      })
      .sort((a, b) => {
        // 담당 먼저 → 레벨 내림차순 → 이름
        if (a.relation !== b.relation) return a.relation === 'direct' ? -1 : 1;
        const la = a.record.employee.growth_level ?? 1;
        const lb = b.record.employee.growth_level ?? 1;
        if (lb !== la) return lb - la;
        return a.record.employee.name.localeCompare(b.record.employee.name, 'ko-KR');
      });
  }, [rows, selectedLevel, relationFilter, orgFilter]);

  const directCount = useMemo(() => rows.filter((r) => r.relation === 'direct').length, [rows]);
  const lineCount = rows.length - directCount;

  // 레벨별 달성 바차트 — 레벨 필터엔 반응하지 않고(레벨 개요 유지), 관계·조직 필터에만 반응.
  const levelStats = useMemo<LevelStat[]>(() => {
    const buckets = new Map<number, { total: number; achieved: number; missed: number; pending: number }>();
    rows
      .filter((row) => {
        if (relationFilter !== 'all' && row.relation !== relationFilter) return false;
        return matchesOrgNodes(recordOrg(row.record), orgFilter);
      })
      .forEach(({ record: r }) => {
        const lv = r.employee.growth_level ?? 1;
        const b = buckets.get(lv) ?? { total: 0, achieved: 0, missed: 0, pending: 0 };
        b.total += 1;
        const completed = r.reviewStatus === 'completed' || r.reviewStatus === 'locked';
        if (completed) {
          if (r.achieved) b.achieved += 1;
          else b.missed += 1;
        } else b.pending += 1;
        buckets.set(lv, b);
      });
    return [...buckets.entries()]
      .filter(([, b]) => b.total > 0)
      .sort(([a], [b]) => b - a)
      .map(([level, b]) => ({ level, label: `Lv.${level}`, ...b }));
  }, [rows, relationFilter, orgFilter]);

  const openRow = (row: Row) => {
    if (row.relation === 'direct') navigate(`/evaluation/${row.record.employee.employee_id}`);
    else navigate(`/team/dept-member?evaluatee=${encodeURIComponent(row.record.employee.employee_id)}`);
  };

  const relationOptions: { key: 'all' | Relation; label: string }[] = [
    { key: 'all', label: `전체 ${rows.length}` },
    { key: 'direct', label: `담당 ${directCount}` },
    { key: 'line', label: `열람 ${lineCount}` },
  ];

  return (
    <>
      <PageHeader
        title="담당 팀원"
        subtitle={`내가 평가하는 ${directCount}명 · 평가 라인 하위 열람 ${lineCount}명`}
      />

      <div style={{ padding: '14px 32px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {isLoading ? (
          <LoadingState message="팀원 정보를 불러오는 중입니다." />
        ) : error ? (
          <ErrorState message="팀원 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." onRetry={() => void reload()} />
        ) : rows.length === 0 ? (
          <div className="sd-card">표시할 팀원이 없습니다.</div>
        ) : (
          <>
            {/* 필터 바 — 2그룹(① 관계+레벨, ② 조직) */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {relationOptions.map((opt) => (
                  <button
                    key={opt.key}
                    className={
                      relationFilter === opt.key ? 'sd-btn sd-btn-primary sd-btn-sm' : 'sd-btn sd-btn-outline sd-btn-sm'
                    }
                    onClick={() => setRelationFilter(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
                <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', minHeight: 20, margin: '0 2px' }} />
                <button
                  className={selectedLevel === 'all' ? 'sd-btn sd-btn-primary sd-btn-sm' : 'sd-btn sd-btn-outline sd-btn-sm'}
                  onClick={() => setSelectedLevel('all')}
                >
                  전체 레벨
                </button>
                {growthLevels.map((level) => (
                  <button
                    key={level}
                    className={
                      selectedLevel === level ? 'sd-btn sd-btn-primary sd-btn-sm' : 'sd-btn sd-btn-outline sd-btn-sm'
                    }
                    onClick={() => setSelectedLevel(level)}
                  >
                    Lv.{level}
                  </button>
                ))}
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <OrgChecklist items={rows.map((r) => recordOrg(r.record))} value={orgFilter} onChange={setOrgFilter} />
              </div>
            </div>

            {/* 바차트(좌) · 리스트(우) — 한 화면, 리스트는 내부 스크롤 */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {levelStats.length > 0 && (
                <div style={{ flex: '0 0 360px', maxWidth: 360 }}>
                  <LevelBarChart
                    data={levelStats}
                    selectedLevel={selectedLevel}
                    onPick={(lv) => setSelectedLevel((prev) => (prev === lv ? 'all' : lv))}
                  />
                </div>
              )}
              <div className="sd-card" style={{ flex: 1, minWidth: 0, padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 250px)', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
                <thead>
                  <tr>
                    <th style={th}>이름</th>
                    <th style={th}>직책</th>
                    <th style={th}>법인</th>
                    <th style={th}>본부</th>
                    <th style={th}>부</th>
                    <th style={th}>팀</th>
                    <th style={{ ...th, textAlign: 'center' }}>레벨</th>
                    <th style={{ ...th, textAlign: 'center' }}>관계</th>
                    <th style={th}>상태</th>
                    <th style={{ ...th, textAlign: 'right' }}>점수</th>
                    <th style={th}>근무기간</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td style={{ ...td, color: 'var(--fg-muted)', textAlign: 'center' }} colSpan={11}>
                        선택한 조건에 맞는 팀원이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map(({ record: r, relation }) => {
                      const org = recordOrg(r);
                      const status = statusOf(r);
                      const hasScore = r.weightedScore > 0;
                      const since = sinceMap.get(r.employee.employee_id);
                      const sinceLabel = formatWorkDate(since);
                      return (
                        <tr
                          key={r.employee.employee_id}
                          onClick={() => openRow({ record: r, relation })}
                          style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--bg-muted)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <td style={td}>
                            <span style={{ fontWeight: 700 }}>{r.employee.name}</span>
                          </td>
                          <td style={{ ...td, color: 'var(--fg-muted)' }}>{r.employee.position || '-'}</td>
                          <td style={{ ...td, color: 'var(--fg-muted)' }}>{getOrgValue(org, 'corporation') || '-'}</td>
                          <td style={{ ...td, color: 'var(--fg-muted)' }}>{getOrgValue(org, 'division') || '-'}</td>
                          <td style={{ ...td, color: 'var(--fg-muted)' }}>{getOrgValue(org, 'department') || '-'}</td>
                          <td style={{ ...td, color: 'var(--fg-muted)' }}>{getOrgValue(org, 'team') || '-'}</td>
                          <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>
                            Lv.{r.employee.growth_level ?? 1}
                          </td>
                          <td style={{ ...td, textAlign: 'center' }}>
                            <RelationChip relation={relation} />
                          </td>
                          <td style={{ ...td, fontWeight: 700, color: status.color }}>{status.label}</td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <span
                              className="tnum"
                              style={{
                                fontWeight: 800,
                                color: hasScore ? getScoreColor(r.flooredScore) : 'var(--fg-muted)',
                              }}
                            >
                              {hasScore ? formatScore(r.weightedScore) : '–'}
                            </span>
                          </td>
                          <td className="tnum" style={{ ...td, color: 'var(--fg-muted)' }}>
                            {sinceLabel ? `${sinceLabel} ~ 현재` : lineLoading ? '…' : '정보 없음'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
};

const LevelBarChart = ({
  data,
  selectedLevel,
  onPick,
}: {
  data: LevelStat[];
  selectedLevel: number | 'all';
  onPick: (level: number) => void;
}) => (
  <div className="sd-card" style={{ padding: 18 }}>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
      <div>
        <div className="sd-label-mini">레벨 현황</div>
        <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginTop: 2 }}>레벨별 달성 현황</h3>
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 700 }}>
        {LEVEL_LEGEND.map((item) => (
          <span key={item.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: item.color, flexShrink: 0 }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, left: -16, bottom: 0 }} barCategoryGap="34%">
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: 'var(--fg)', fontWeight: 800 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(245,80,0,0.06)' }}
            contentStyle={{
              borderRadius: 10,
              border: '1px solid var(--border)',
              fontSize: 'var(--fs-sm)',
              background: 'var(--bg-card)',
            }}
            formatter={(value: number, name: string) => [`${value}명`, name]}
          />
          {(['achieved', 'missed', 'pending'] as const).map((key) => {
            const cfg = {
              achieved: { name: '달성', color: COLOR_ACHIEVED },
              missed: { name: '미달성', color: COLOR_MISSED },
              pending: { name: '미완료', color: COLOR_PENDING },
            }[key];
            const isLast = key === 'pending';
            return (
              <Bar
                key={key}
                stackId="count"
                dataKey={key}
                name={cfg.name}
                fill={cfg.color}
                radius={isLast ? [5, 5, 0, 0] : [0, 0, 0, 0]}
                onClick={(d: { level?: number }) => d?.level != null && onPick(d.level)}
                style={{ cursor: 'pointer' }}
              >
                {data.map((row) => {
                  const active = selectedLevel === 'all' || selectedLevel === row.level;
                  return <Cell key={row.level} fillOpacity={active ? 1 : 0.32} />;
                })}
                {isLast && (
                  <LabelList
                    dataKey="total"
                    position="top"
                    formatter={(v: number) => (v > 0 ? `${v}` : '')}
                    style={{ fontSize: 11, fontWeight: 800, fill: 'var(--fg-muted)' }}
                  />
                )}
              </Bar>
            );
          })}
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
);

export default TeamMembersPage;
