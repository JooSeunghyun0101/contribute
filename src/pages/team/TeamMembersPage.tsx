import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/Layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useTeamDashboardRecords } from '@/hooks/useDashboardRecords';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';

const CARD_WIDTH = 300;
const CARD_GAP = 16;

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(d);
};

const TeamMembersPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { records, isLoading, error } = useTeamDashboardRecords(user?.employeeId || '');
  const [selectedLevel, setSelectedLevel] = useState<number | 'all'>('all');

  const growthLevels = useMemo(
    () =>
      Array.from(new Set(records.map((record) => record.employee.growth_level ?? 1))).sort(
        (a, b) => a - b,
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
      .sort(([a], [b]) => a - b)
      .map(([level, items]) => ({
        level,
        items: [...items].sort((a, b) => a.employee.name.localeCompare(b.employee.name, 'ko-KR')),
      }));
  }, [visibleRecords]);

  return (
    <>
      <PageHeader
        title="담당 팀원"
        subtitle={`내가 평가하는 ${records.length > 0 ? `${records[0]?.employee.department} ` : ''}${records.length}명`}
      />

      <div style={{ padding: '24px 32px 32px' }}>
        {isLoading ? (
          <div className="sd-card">팀원 정보를 불러오는 중입니다.</div>
        ) : error ? (
          <div className="sd-card" style={{ color: 'var(--danger)' }}>{error}</div>
        ) : (
          <div className="flex flex-col gap-6">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className={selectedLevel === 'all' ? 'sd-btn sd-btn-primary sd-btn-sm' : 'sd-btn sd-btn-outline sd-btn-sm'}
                onClick={() => setSelectedLevel('all')}
              >
                전체 {records.length}
              </button>
              {growthLevels.map((level) => {
                const count = records.filter((record) => (record.employee.growth_level ?? 1) === level).length;
                return (
                  <button
                    key={level}
                    className={selectedLevel === level ? 'sd-btn sd-btn-primary sd-btn-sm' : 'sd-btn sd-btn-outline sd-btn-sm'}
                    onClick={() => setSelectedLevel(level)}
                  >
                    Lv.{level} {count}
                  </button>
                );
              })}
            </div>

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

const MemberCard = ({ record, onOpen }: MemberCardProps) => {
  const latestFeedbackDate = record.tasks
    .flatMap((t) => t.feedbackHistory ?? [])
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]?.date;
  const recentDate = formatDate(latestFeedbackDate);
  const completedCount = record.completedTasks;
  const totalCount = record.totalTasks;

  return (
    <div
      className="sd-card sd-card-lg"
      style={{
        position: 'relative',
        height: 232,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {record.achieved && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            fontSize: 'var(--fs-xs)',
            fontWeight: 700,
            color: '#16A34A',
            background: '#DCFCE7',
            padding: '2px 8px',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span>✓</span> 달성
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div
          style={{
            width: 48,
            height: 48,
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
        <div>
          <div style={{ fontSize: 'var(--fs-h4)', fontWeight: 700 }}>
            {record.employee.name}{' '}
            <span style={{ fontSize: 'var(--fs-body)', fontWeight: 500, color: 'var(--fg-muted)' }}>
              {record.employee.position}
            </span>
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginTop: 2 }}>
            {record.employee.department} · Lv.{record.employee.growth_level ?? 1}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 600, marginBottom: 4 }}>
            현재 점수
          </div>
          <div
            style={{
              fontSize: 'var(--fs-h1)',
              fontWeight: 900,
              color: 'var(--ok-orange)',
              lineHeight: 1,
            }}
          >
            {record.weightedScore > 0 ? record.weightedScore.toFixed(1) : '–'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', fontWeight: 600, marginBottom: 8 }}>
            평가 진행률
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                }}
              />
            </div>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
              {completedCount}/{totalCount}
            </span>
          </div>
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
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)' }}>
          {recentDate ? `최근 활동 · ${recentDate}` : '활동 기록 없음'}
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
