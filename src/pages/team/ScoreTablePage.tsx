import { useMemo } from 'react';
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
import { useAuth } from '@/contexts/AuthContext';
import { useTeamDashboardRecords } from '@/hooks/useDashboardRecords';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';
import { MATRIX_SCORE_COLORS, MATRIX_SCORE_TEXT_COLORS } from '@/lib/evaluationMatrix';

const SCORE_BG = MATRIX_SCORE_COLORS;
const SCORE_TEXT = MATRIX_SCORE_TEXT_COLORS;

const SCORE_COLUMNS = [4, 3, 2, 1] as const;

const getReviewAction = (record: EmployeeEvaluationRecord) => {
  switch (record.reviewStatus) {
    case 'submitted':
      return {
        statusLabel: '검토 대기',
        actionLabel: '평가 시작',
        disabled: false,
        background: 'var(--ok-orange-50)',
        color: 'var(--ok-orange-700)',
      };
    case 'evaluating':
      return {
        statusLabel: '평가 중',
        actionLabel: '계속 평가',
        disabled: false,
        background: 'var(--info-bg)',
        color: 'var(--info)',
      };
    case 'completed':
      return {
        statusLabel: '완료',
        actionLabel: '상세 보기',
        disabled: false,
        background: 'var(--success-bg)',
        color: 'var(--success)',
      };
    case 'locked':
      return {
        statusLabel: '잠금',
        actionLabel: '상세 보기',
        disabled: false,
        background: 'var(--bg-muted)',
        color: 'var(--fg-muted)',
      };
    case 'not-started':
    case 'draft':
    default:
      return {
        statusLabel: '작성 중',
        actionLabel: '제출 전',
        disabled: true,
        background: 'var(--bg-muted)',
        color: 'var(--fg-muted)',
      };
  }
};

const ScoreBucketCell = ({ count, total }: { count: number; total: number }) => {
  const ratio = total > 0 ? Math.round((count / total) * 100) : 0;

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 'var(--fs-h4)', fontWeight: 900, lineHeight: 1.1 }}>{count}</div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 2 }}>{ratio}%</div>
    </div>
  );
};

const ScoreTablePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { records, isLoading, error } = useTeamDashboardRecords(user?.employeeId || '');

  const allScores = useMemo(
    () => records.flatMap((r) => r.tasks.map((t) => t.score).filter((s): s is number => s != null)),
    [records],
  );
  const totalScores = allScores.length;
  const distribution = SCORE_COLUMNS.map((v) => ({
    score: v,
    count: allScores.filter((s) => s === v).length,
  }));

  return (
    <>
      <PageHeader
        title="직원별 점수"
        subtitle="팀원별 점수 분포와 반영 점수 · 셀은 해당 점수 과업 수와 비율"
      />

      <div style={{ padding: '24px 32px 32px' }} className="flex flex-col gap-5">
        <div className="sd-card sd-card-lg" style={{ padding: 0, overflow: 'hidden' }}>
          {isLoading ? (
            <div style={{ padding: 20, color: 'var(--fg-muted)' }}>점수 테이블을 불러오는 중입니다.</div>
          ) : error ? (
            <div style={{ padding: 20, color: 'var(--danger)' }}>{error}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)' }}>
                  {['직원', '4점', '3점', '2점', '1점', '반영 점수', '진행률', '상태', '달성', ''].map((col) => (
                    <th
                      key={col}
                      style={{
                        padding: '10px 14px',
                        fontSize: 'var(--fs-xs)',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        color: 'var(--fg-muted)',
                        textAlign: col === '' ? 'right' : col === '반영 점수' ? 'center' : 'left',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const completedCount = record.completedTasks;
                  const totalCount = record.totalTasks;
                  const scoreCounts = SCORE_COLUMNS.reduce<Record<number, number>>((acc, score) => {
                    acc[score] = record.tasks.filter((task) => task.score === score).length;
                    return acc;
                  }, {});
                  const reviewAction = getReviewAction(record);

                  return (
                    <tr
                      key={record.employee.employee_id}
                      style={{ borderBottom: '1px solid var(--border)' }}
                    >
                      {/* Employee */}
                      <td style={{ padding: '14px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: '50%',
                              background: 'var(--ok-orange)',
                              color: '#fff',
                              fontSize: 'var(--fs-body)',
                              fontWeight: 800,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {record.employee.name.charAt(0)}
                          </div>
                          <div>
                            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>
                              {record.employee.name}{' '}
                              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--fg-muted)' }}>
                                {record.employee.position}
                              </span>
                            </div>
                            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 2 }}>
                              {record.employee.department} · Lv.{record.employee.growth_level ?? 1}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Score distribution */}
                      {SCORE_COLUMNS.map((score) => (
                        <td key={score} style={{ padding: '14px 10px', textAlign: 'center' }}>
                          <ScoreBucketCell count={scoreCounts[score] ?? 0} total={totalCount} />
                        </td>
                      ))}

                      {/* Weighted score */}
                      <td style={{ padding: '14px 14px', textAlign: 'center' }}>
                        {record.weightedScore > 0 ? (
                          <div>
                            <div
                              style={{
                                fontSize: 'var(--fs-h3)',
                                fontWeight: 800,
                                color: 'var(--ok-orange)',
                                lineHeight: 1,
                              }}
                            >
                              {record.weightedScore.toFixed(1)}
                            </div>
                            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 2 }}>
                              절사 {record.flooredScore}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>-</span>
                        )}
                      </td>

                      {/* Progress bar */}
                      <td style={{ padding: '14px 14px', minWidth: 160 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              flex: 1,
                              height: 6,
                              background: 'var(--bg-muted)',
                              borderRadius: 4,
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${record.progress}%`,
                                background: record.progress >= 100 ? '#16A34A' : 'var(--ok-orange)',
                                borderRadius: 4,
                                transition: 'width 0.4s',
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                            {completedCount}/{totalCount} · {record.progress}%
                          </span>
                        </div>
                      </td>

                      {/* Review status */}
                      <td style={{ padding: '14px 14px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '3px 10px',
                            borderRadius: 12,
                            fontSize: 'var(--fs-sm)',
                            fontWeight: 700,
                            background: reviewAction.background,
                            color: reviewAction.color,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {reviewAction.statusLabel}
                        </span>
                      </td>

                      {/* 달성 */}
                      <td style={{ padding: '14px 14px' }}>
                        <span
                          style={{
                            padding: '3px 10px',
                            borderRadius: 12,
                            fontSize: 'var(--fs-sm)',
                            fontWeight: 700,
                            background: record.achieved ? '#DCFCE7' : '#FEF9C3',
                            color: record.achieved ? '#16A34A' : '#A16207',
                          }}
                        >
                          {record.achieved ? '달성' : '미달'}
                        </span>
                      </td>

                      {/* Action */}
                      <td style={{ padding: '14px 14px', textAlign: 'right' }}>
                        <button
                          className="sd-btn sd-btn-ghost sd-btn-sm"
                          onClick={() => {
                            if (!reviewAction.disabled) {
                              navigate(`/evaluation/${record.employee.employee_id}`);
                            }
                          }}
                          disabled={reviewAction.disabled}
                          title={reviewAction.disabled ? '피평가자가 최종제출한 뒤 평가할 수 있습니다.' : undefined}
                          style={{
                            whiteSpace: 'nowrap',
                            opacity: reviewAction.disabled ? 0.55 : 1,
                            cursor: reviewAction.disabled ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {reviewAction.actionLabel} &gt;
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Score distribution chart */}
        {!isLoading && totalScores > 0 && (
          <div className="sd-card sd-card-lg">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 14,
              }}
            >
              <div>
                <div className="sd-label-mini">점수 분포</div>
                <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, marginTop: 2 }}>
                  팀 전체 과업 점수 분포
                </h3>
              </div>
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 600 }}>
                평가 완료 {totalScores}건
              </span>
            </div>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={distribution.map((d) => ({
                    label: `${d.score}점`,
                    score: d.score,
                    count: d.count,
                    ratio: totalScores > 0 ? Math.round((d.count / totalScores) * 100) : 0,
                  }))}
                  margin={{ top: 16, right: 12, left: -20, bottom: 0 }}
                  barCategoryGap="30%"
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 'var(--fs-sm)', fill: 'var(--fg-muted)', fontWeight: 700 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 'var(--fs-xs)', fill: 'var(--fg-muted)' }}
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
                    formatter={(_value, _name, props: any) => [
                      `${props.payload.count}건 (${props.payload.ratio}%)`,
                      `${props.payload.label} 분포`,
                    ]}
                  />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                    {distribution.map(({ score }) => (
                      <Cell key={score} fill={SCORE_BG[score]} />
                    ))}
                    <LabelList
                      dataKey="ratio"
                      position="top"
                      formatter={(v: number) => `${v}%`}
                      style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, fill: 'var(--fg)' }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 점수별 칩 요약 */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                marginTop: 12,
              }}
            >
              {distribution.map(({ score, count }) => (
                <div
                  key={score}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 10px',
                    borderRadius: 12,
                    background: 'var(--bg-muted)',
                    border: '1px solid var(--border)',
                    fontSize: 'var(--fs-sm)',
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: SCORE_BG[score],
                      color: SCORE_TEXT[score],
                      fontSize: 'var(--fs-xs)',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {score}
                  </span>
                  <span style={{ fontWeight: 700 }}>{count}건</span>
                  <span style={{ color: 'var(--fg-muted)' }}>
                    {totalScores > 0 ? Math.round((count / totalScores) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default ScoreTablePage;
