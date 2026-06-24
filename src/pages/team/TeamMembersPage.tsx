import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/Layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamDashboardRecords, useFormerTeamDashboardRecords } from '@/hooks/useDashboardRecords';
import { formatScore, getScoreColor } from '@/lib/evaluationMatrix';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

const CARD_WIDTH = 300;
const CARD_GAP = 16;

const formatWorkDate = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

const formatWorkPeriod = (start?: string | null, end?: string | null) => {
  const s = formatWorkDate(start);
  const e = formatWorkDate(end);
  if (!s && !e) return null;
  if (s && e) return `${s} ~ ${e}`;
  if (s) return `${s} ~ 현재`;
  return `이전 ~ ${e}`;
};

const TeamMembersPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const evaluatorId = user?.employeeId || '';
  const { records: allRecords, isLoading, error } = useTeamDashboardRecords(evaluatorId);
  // 발령 전 담당 팀원도 포함 — 과거 기간 조회 시 그 기간의 담당 팀원이 보이도록.
  const { records: formerRecords } = useFormerTeamDashboardRecords(evaluatorId);
  // "담당 팀원" = 선택 기간 평가의 배정 평가자(evaluation.evaluator_id)가 본인인 레코드.
  // (이전엔 현재 담당만 보여, 25년 조회 시에도 26년 담당이 나오던 문제 해소.)
  const records = useMemo(() => {
    const map = new Map<string, EmployeeEvaluationRecord>();
    for (const r of allRecords) map.set(r.employee.employee_id, r);
    for (const r of formerRecords) if (!map.has(r.employee.employee_id)) map.set(r.employee.employee_id, r);
    return [...map.values()].filter((r) => String(r.evaluation?.evaluator_id ?? '') === evaluatorId);
  }, [allRecords, formerRecords, evaluatorId]);
  const [selectedLevel, setSelectedLevel] = useState<number | 'all'>('all');

  const growthLevels = useMemo(
    () =>
      Array.from(new Set(records.map((record) => record.employee.growth_level ?? 1))).sort(
        (a, b) => b - a,
      ),
    [records],
  );

  const visibleRecords = useMemo(
    () =>
      selectedLevel === 'all'
        ? records
        : records.filter((record) => (record.employee.growth_level ?? 1) === selectedLevel),
    [records, selectedLevel],
  );

  const groupedByLevel = useMemo(() => {
    const groups = new Map<number, EmployeeEvaluationRecord[]>();
    visibleRecords.forEach((record) => {
      const level = record.employee.growth_level ?? 1;
      const group = groups.get(level) ?? [];
      group.push(record);
      groups.set(level, group);
    });

    return Array.from(groups.entries())
      .sort(([a], [b]) => b - a)
      .map(([level, items]) => ({
        level,
        items: [...items].sort((a, b) => {
          // 달성 → 미달성 → 미완료 순, 같은 상태 안에서는 점수 내림차순
          const stateRank: Record<AchievementState, number> = {
            achieved: 0,
            missed: 1,
            pending: 2,
          };
          const sa = getAchievementState(a);
          const sb = getAchievementState(b);
          if (sa !== sb) return stateRank[sa] - stateRank[sb];
          if (b.weightedScore !== a.weightedScore) return b.weightedScore - a.weightedScore;
          return a.employee.name.localeCompare(b.employee.name, 'ko-KR');
        }),
      }));
  }, [visibleRecords]);

  return (
    <>
      <PageHeader
        title="담당 팀원"
        subtitle={`내가 평가하는 ${records.length > 0 ? `${records[0]?.employee.department} ` : ''}${records.length}명`}
        filters={
          records.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className={selectedLevel === 'all' ? 'sd-btn sd-btn-primary sd-btn-sm' : 'sd-btn sd-btn-outline sd-btn-sm'}
                onClick={() => setSelectedLevel('all')}
              >
                전체 · {records.length}명
              </button>
              {growthLevels.map((level) => {
                const count = records.filter((record) => (record.employee.growth_level ?? 1) === level).length;
                return (
                  <button
                    key={level}
                    className={selectedLevel === level ? 'sd-btn sd-btn-primary sd-btn-sm' : 'sd-btn sd-btn-outline sd-btn-sm'}
                    onClick={() => setSelectedLevel(level)}
                  >
                    Lv.{level} · {count}명
                  </button>
                );
              })}
            </div>
          ) : undefined
        }
      />

      <div style={{ padding: '24px 32px 32px' }}>
        {isLoading ? (
          <div className="sd-card">팀원 정보를 불러오는 중입니다.</div>
        ) : error ? (
          <div className="sd-card" style={{ color: 'var(--danger)' }}>{error}</div>
        ) : (
          <div className="flex flex-col gap-6">
            {groupedByLevel.map(({ level, items }) => (
              <MemberCarousel
                key={level}
                level={level}
                items={items}
                onOpen={(record) => navigate(`/evaluation/${record.employee.employee_id}`)}
              />
            ))}

            {!records.length && <div className="sd-card">표시할 팀원이 없습니다.</div>}
            {records.length > 0 && !visibleRecords.length && (
              <div className="sd-card">선택한 성장레벨에 해당하는 팀원이 없습니다.</div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

type MemberCarouselProps = {
  level: number;
  items: EmployeeEvaluationRecord[];
  onOpen: (record: EmployeeEvaluationRecord) => void;
};

const MemberCarousel = ({ level, items, onOpen }: MemberCarouselProps) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const scrollByPage = (direction: 'prev' | 'next') => {
    const node = scrollerRef.current;
    if (!node) return;
    const delta = (CARD_WIDTH + CARD_GAP) * 2 * (direction === 'next' ? 1 : -1);
    node.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div>
          <div className="sd-label-mini">성장 레벨</div>
          <h2 style={{ fontSize: 'var(--fs-h3)', fontWeight: 900, marginTop: 2 }}>Lv.{level}</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', fontWeight: 700 }}>
            {items.length}명
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => scrollByPage('prev')}
              aria-label="이전"
              style={carouselNavStyle}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => scrollByPage('next')}
              aria-label="다음"
              style={carouselNavStyle}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollerRef}
        style={{
          display: 'flex',
          gap: CARD_GAP,
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          paddingBottom: 6,
          // 우측 끝까지 카드가 닿지 않게 약간의 여백
          paddingRight: 4,
        }}
      >
        {items.map((record) => (
          <div
            key={record.employee.employee_id}
            style={{
              flex: `0 0 ${CARD_WIDTH}px`,
              scrollSnapAlign: 'start',
            }}
          >
            <MemberCard record={record} onOpen={() => onOpen(record)} />
          </div>
        ))}
      </div>
    </section>
  );
};

const carouselNavStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--fg)',
  fontSize: 'var(--fs-h4)',
  fontWeight: 800,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
};

type MemberCardProps = {
  record: EmployeeEvaluationRecord;
  onOpen: () => void;
};

type AchievementState = 'achieved' | 'missed' | 'pending';

const getAchievementState = (record: EmployeeEvaluationRecord): AchievementState => {
  // 평가 완료(or 잠금) 상태만 달성/미달성으로 분류. 그 외는 모두 미완료.
  const isCompleted =
    record.reviewStatus === 'completed' || record.reviewStatus === 'locked';
  if (!isCompleted) return 'pending';
  return record.achieved ? 'achieved' : 'missed';
};

// 점수 색상표 기준 — 4점 진오렌지(달성), 2점 머스터드(미달성), 회색(미완료)
const ACHIEVEMENT_STYLE: Record<
  AchievementState,
  { label: string; chipBg: string; chipColor: string; accent: string }
> = {
  achieved: {
    label: '달성',
    chipBg: 'var(--ok-orange-50)',
    chipColor: '#E84200',
    accent: '#E84200',
  },
  missed: {
    label: '미달성',
    chipBg: 'var(--warning-bg)',
    chipColor: '#A06A3D',
    accent: '#E8B588',
  },
  pending: {
    label: '미완료',
    chipBg: 'var(--bg-muted)',
    chipColor: 'var(--fg-muted)',
    accent: 'var(--border)',
  },
};

const MemberCard = ({ record, onOpen }: MemberCardProps) => {
  const workPeriod = formatWorkPeriod(
    record.employee.work_start_date,
    record.employee.work_end_date,
  );
  const state = getAchievementState(record);
  const palette = ACHIEVEMENT_STYLE[state];
  const growthLevel = record.employee.growth_level ?? 1;
  const scoreColor = getScoreColor(record.flooredScore);
  const scoreFraction = Math.min(100, Math.max(0, (record.weightedScore / 4) * 100));
  const hasScore = record.weightedScore > 0;

  // 상태별 카드 테두리 — 달성/미달성은 solid 강조, 미완료는 dashed로 약하게
  const cardBorder =
    state === 'achieved'
      ? `2px solid ${palette.accent}`
      : state === 'missed'
        ? `2px solid ${palette.accent}`
        : '2px dashed var(--border)';

  return (
    <div
      className="sd-card sd-card-lg"
      style={{
        position: 'relative',
        height: 232,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        border: cardBorder,
      }}
    >
      {/* 우상단 상태 라벨 (이모지 없음) */}
      {state !== 'pending' && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            padding: '3px 12px',
            borderRadius: 999,
            background: palette.chipBg,
            color: palette.chipColor,
            fontSize: 'var(--fs-xs)',
            fontWeight: 800,
            letterSpacing: '0.04em',
          }}
        >
          {palette.label}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, paddingRight: 64 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'var(--ok-orange)',
            color: '#fff',
            fontSize: 'var(--fs-h3)',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {record.employee.name.charAt(0)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 'var(--fs-h4)',
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {record.employee.name}{' '}
            <span style={{ fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--fg-muted)' }}>
              {record.employee.position}
            </span>
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 2 }}>
            {record.employee.department} · Lv.{growthLevel}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span
              className="tnum"
              style={{
                fontSize: 'var(--fs-h1)',
                fontWeight: 900,
                color: hasScore ? scoreColor : 'var(--fg-muted)',
                lineHeight: 1.0,
              }}
            >
              {hasScore ? formatScore(record.weightedScore) : '–'}
            </span>
            <span style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--fg-muted)' }}>
              / 4.0
            </span>
          </div>
        </div>

        <div
          style={{
            height: 8,
            background: 'var(--bg-muted)',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${scoreFraction}%`,
              background: scoreColor,
              borderRadius: 4,
              transition: 'width 0.4s',
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'auto',
        }}
      >
        <div className="tnum" style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
          {workPeriod ? `근무 ${workPeriod}` : '근무기간 정보 없음'}
        </div>
        <button
          className="sd-btn sd-btn-ghost sd-btn-sm"
          style={{ color: 'var(--ok-orange)', fontWeight: 700 }}
          onClick={onOpen}
        >
          상세 보기 &gt;
        </button>
      </div>
    </div>
  );
};

export default TeamMembersPage;
