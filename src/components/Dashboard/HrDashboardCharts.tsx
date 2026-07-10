import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// HR 대시보드 그래프 모음 — 도넛(완료율·달성·상태), 성장레벨 분포, 점수 분포, 부서 비교.
// 색상은 OK 브랜드 + 점수 팔레트와 통일.
// 색은 OK 브랜드 + 점수 단계 팔레트로 한정(이질색 파랑/네온 제거). 값은 index.css 토큰 추종.
export const HR_COLOR = {
  orange: 'var(--ok-orange-brand)',
  achieved: 'var(--score-4-bg)',
  missed: 'var(--score-2-bg)',
  pending: 'var(--score-1-bg)',
  amber: 'var(--score-3-bg)',
  blue: 'var(--ok-brown)',
} as const;

const tooltipStyle = {
  borderRadius: 10,
  border: '1px solid var(--border)',
  fontSize: 'var(--fs-sm)',
  background: 'var(--bg-card)',
} as const;

export type DonutSegment = { key: string; name: string; value: number; color: string };

/** 가운데 큰 수치를 보여주는 도넛. onSelect 지정 시 조각·범례 클릭 → onSelect(segment.key). */
export const Donut = ({
  segments,
  centerValue,
  centerLabel,
  centerColor = HR_COLOR.orange,
  height = 170,
  onSelect,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
  centerColor?: string;
  height?: number;
  onSelect?: (key: string) => void;
}) => {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const data = total > 0 ? segments.filter((s) => s.value > 0) : [{ key: 'empty', name: '데이터 없음', value: 1, color: 'var(--bg-muted)' }];
  const handleSelect = (key: string | undefined) => {
    if (key && key !== 'empty') onSelect?.(key);
  };
  return (
    <div>
      <div style={{ position: 'relative', width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="66%"
              outerRadius="92%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={total > 0 ? 2 : 0}
              isAnimationActive={false}
              onClick={(d: { payload?: DonutSegment } & Partial<DonutSegment>) =>
                handleSelect(d?.key ?? d?.payload?.key)
              }
              style={onSelect && total > 0 ? { cursor: 'pointer' } : undefined}
            >
              {data.map((d) => (
                <Cell key={d.key} fill={d.color} stroke="var(--bg-card)" strokeWidth={2} />
              ))}
            </Pie>
            {total > 0 && (
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => [`${value}명`, name]}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span className="tnum" style={{ fontSize: 'var(--fs-h1)', fontWeight: 900, color: centerColor, lineHeight: 1 }}>
            {centerValue}
          </span>
          <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--fg-muted)', marginTop: 4 }}>
            {centerLabel}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 10 }}>
        {segments.map((s) =>
          onSelect ? (
            <button
              key={s.key}
              type="button"
              onClick={() => handleSelect(s.key)}
              title={`${s.name} 명단 보기`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 'var(--fs-xs)',
                color: 'var(--fg-muted)',
                fontWeight: 700,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, display: 'inline-block' }} />
              {s.name} <span className="tnum" style={{ color: 'var(--fg)' }}>{s.value}</span>
            </button>
          ) : (
            <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 700 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, display: 'inline-block' }} />
              {s.name} <span className="tnum" style={{ color: 'var(--fg)' }}>{s.value}</span>
            </span>
          ),
        )}
      </div>
    </div>
  );
};

/** 카드 + 제목 래퍼. */
export const ChartCard = ({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) => (
  <div className="sd-card sd-card-lg" style={{ display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
      <div>
        <h3 style={{ fontSize: 'var(--fs-h4)', fontWeight: 800 }}>{title}</h3>
        {subtitle && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 3 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
  </div>
);

export type LevelDatum = { label: string; level: number; achieved: number; missed: number; pending: number };

/** 성장레벨(Lv.1~4)별 달성/미달성/미평가 누적 막대. 막대가 아니라 해당 칼럼 영역 클릭 시 onSelect(level). */
export const LevelDistChart = ({ data, onSelect }: { data: LevelDatum[]; onSelect?: (level: number) => void }) => (
  <div style={{ width: '100%', height: 240 }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 4, bottom: 0 }}
        barCategoryGap="28%"
        onClick={(s: any) => {
          const level = s?.activePayload?.[0]?.payload?.level;
          if (level != null) onSelect?.(level);
        }}
        style={onSelect ? { cursor: 'pointer' } : undefined}
      >
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--fg)', fontWeight: 800 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--fg-muted)' }} axisLine={false} tickLine={false} width={34} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${v}명`, n]} cursor={{ fill: 'rgba(245,80,0,0.08)' }} />
        <Bar dataKey="achieved" name="달성" stackId="a" fill={HR_COLOR.achieved} />
        <Bar dataKey="missed" name="미달성" stackId="a" fill={HR_COLOR.missed} />
        <Bar dataKey="pending" name="미평가" stackId="a" fill={HR_COLOR.pending} radius={[5, 5, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export type ScoreDatum = { label: string; score: number; count: number };

/** 점수(1~4점) 분포 막대. 막대가 아니라 해당 칼럼 영역 클릭 시 onSelect(score). */
export const ScoreDistChart = ({ data, onSelect }: { data: ScoreDatum[]; onSelect?: (score: number) => void }) => {
  const colors = [HR_COLOR.pending, HR_COLOR.missed, HR_COLOR.amber, HR_COLOR.achieved];
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 18, right: 8, left: 4, bottom: 0 }}
          barCategoryGap="32%"
          onClick={(s: any) => {
            const score = s?.activePayload?.[0]?.payload?.score;
            if (score != null) onSelect?.(score);
          }}
          style={onSelect ? { cursor: 'pointer' } : undefined}
        >
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--fg)', fontWeight: 800 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--fg-muted)' }} axisLine={false} tickLine={false} width={34} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}명`, '인원']} cursor={{ fill: 'rgba(245,80,0,0.08)' }} />
          <Bar dataKey="count" name="인원" radius={[5, 5, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i] ?? HR_COLOR.orange} />
            ))}
            <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 800, fill: 'var(--fg)' }} formatter={(v: number) => (v > 0 ? v : '')} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export type DeptHeadcountDatum = {
  /** 클릭 시 onSelect 로 넘길 식별자(조직 정규화 키 등). 없으면 name 사용. */
  id?: string;
  name: string;
  total: number;
  achieved: number;
  missed: number;
  pending: number;
  achievementRate: number;
};

export type DeptSort = 'achievement' | 'count';

/** 부서별 인원 구성(달성/미달성/미완료) 가로 스택바 리스트 — 정렬 토글 + 스크롤 + 행 클릭. */
export const DeptHeadcountList = ({
  data,
  sort,
  onSortChange,
  onSelect,
  rowsVisible = 5,
  rowHeight = 56,
  fill = false,
}: {
  data: DeptHeadcountDatum[];
  sort: DeptSort;
  onSortChange: (s: DeptSort) => void;
  onSelect?: (name: string) => void;
  rowsVisible?: number;
  rowHeight?: number;
  /** 카드 높이를 꽉 채우고 목록만 스크롤(좌측 차트와 높이 맞출 때). */
  fill?: boolean;
}) => {
  const sorted = [...data].sort((a, b) =>
    sort === 'achievement'
      ? b.achievementRate - a.achievementRate || b.total - a.total
      : b.total - a.total || b.achievementRate - a.achievementRate,
  );
  // 바 길이를 인원수에 비례 — 가장 많은 부서를 100%로.
  const maxTotal = Math.max(1, ...data.map((x) => x.total));
  const segDefs = [
    { key: 'achieved' as const, label: '달성', color: HR_COLOR.orange },
    { key: 'missed' as const, label: '미달성', color: HR_COLOR.missed },
    { key: 'pending' as const, label: '미완료', color: HR_COLOR.pending },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...(fill ? { flex: 1, minHeight: 0 } : {}) }}>
      <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end' }}>
        {([
          { k: 'achievement', l: '달성률순' },
          { k: 'count', l: '인원순' },
        ] as { k: DeptSort; l: string }[]).map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => onSortChange(o.k)}
            style={{
              padding: '3px 10px',
              borderRadius: 7,
              fontSize: 'var(--fs-xs)',
              fontWeight: 700,
              cursor: 'pointer',
              border: `1px solid ${sort === o.k ? 'var(--ok-orange)' : 'var(--border)'}`,
              background: sort === o.k ? 'var(--ok-orange-50)' : 'transparent',
              color: sort === o.k ? 'var(--ok-orange)' : 'var(--fg-muted)',
            }}
          >
            {o.l}
          </button>
        ))}
      </div>

      <div
        style={{
          ...(fill ? { flex: 1, minHeight: 0 } : { maxHeight: rowsVisible * rowHeight }),
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          paddingRight: 4,
        }}
      >
        {sorted.length === 0 ? (
          <div style={{ fontSize: 'var(--fs-body)', color: 'var(--fg-muted)', padding: 12 }}>부서 데이터가 없습니다.</div>
        ) : (
          sorted.map((d) => {
            const denom = d.total || 1;
            return (
              <button
                key={d.id ?? d.name}
                type="button"
                onClick={() => onSelect?.(d.id ?? d.name)}
                style={{
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 8px',
                  cursor: onSelect ? 'pointer' : 'default',
                  font: 'inherit',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.name}
                  </span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    달성 <b className="tnum" style={{ color: 'var(--ok-orange)' }}>{d.achievementRate}%</b> · {d.total}명
                  </span>
                </div>
                <div style={{ height: 12, borderRadius: 6, overflow: 'hidden', background: 'var(--bg-muted)' }} title={`${d.total}명`}>
                  <div
                    style={{
                      display: 'flex',
                      height: '100%',
                      width: `${(d.total / maxTotal) * 100}%`,
                      borderRadius: 6,
                      overflow: 'hidden',
                    }}
                  >
                    {segDefs.map((s) =>
                      d[s.key] > 0 ? (
                        <div key={s.key} style={{ width: `${(d[s.key] / denom) * 100}%`, background: s.color }} title={`${s.label} ${d[s.key]}명`} />
                      ) : null,
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
        {segDefs.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 700 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, display: 'inline-block' }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
};

export type DeptDatum = { name: string; completionRate: number; achievementRate: number; total: number };

/** 부서별 완료율·달성률 비교 — 가로 그룹 막대. 클릭 시 onSelect. */
export const DeptCompareChart = ({ data, onSelect }: { data: DeptDatum[]; onSelect?: (name: string) => void }) => (
  <div style={{ width: '100%', height: Math.max(160, data.length * 46 + 30) }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, left: 8, bottom: 0 }} barCategoryGap="22%">
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12, fill: 'var(--fg)', fontWeight: 700 }}
          axisLine={false}
          tickLine={false}
          width={96}
        />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${v}%`, n]} cursor={{ fill: 'rgba(245,80,0,0.06)' }} />
        <Bar dataKey="completionRate" name="완료율" fill={HR_COLOR.orange} radius={[0, 4, 4, 0]} barSize={11} onClick={(d: any) => onSelect?.(d?.name)} cursor={onSelect ? 'pointer' : undefined}>
          <LabelList dataKey="completionRate" position="right" style={{ fontSize: 10, fontWeight: 800, fill: 'var(--fg-muted)' }} formatter={(v: number) => `${v}%`} />
        </Bar>
        <Bar dataKey="achievementRate" name="달성률" fill={HR_COLOR.amber} radius={[0, 4, 4, 0]} barSize={11} onClick={(d: any) => onSelect?.(d?.name)} cursor={onSelect ? 'pointer' : undefined} />
      </BarChart>
    </ResponsiveContainer>
    <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 4 }}>
      {[
        { c: HR_COLOR.orange, l: '완료율' },
        { c: HR_COLOR.amber, l: '달성률' },
      ].map((x) => (
        <span key={x.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 700 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: x.c, display: 'inline-block' }} />
          {x.l}
        </span>
      ))}
    </div>
  </div>
);
