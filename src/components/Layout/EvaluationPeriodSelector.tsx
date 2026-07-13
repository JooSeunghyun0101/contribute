import { IconCalendar } from '@/components/brand';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import type { EvaluationPeriodStatus } from '@/types';

// 이름에 이미 연도가 들어있으면(예: "2025 Annual Evaluation") 연도를 중복 표기하지 않는다.
const formatPeriodLabel = (name: string, year: number) =>
  name.includes(String(year)) ? name : `${name} · ${year}`;

// 상태 어휘·팔레트는 HrPeriodsPage 의 StatusBadge 와 동일하게 맞춘다(작성 전/진행 중/마감/잠금).
const STATUS_LABEL: Record<EvaluationPeriodStatus, string> = {
  draft: '작성 전',
  active: '진행 중',
  closed: '마감',
  locked: '잠금',
};

const STATUS_STYLE: Record<EvaluationPeriodStatus, { bg: string; fg: string; border: string }> = {
  draft: { bg: 'var(--bg-muted)', fg: 'var(--fg-muted)', border: 'var(--border)' },
  active: { bg: 'var(--ok-orange-50)', fg: 'var(--ok-orange-700)', border: 'var(--ok-orange-100)' },
  closed: { bg: 'var(--success-bg)', fg: 'var(--success)', border: 'transparent' },
  locked: { bg: 'var(--bg-subtle)', fg: 'var(--fg-muted)', border: 'var(--border-strong)' },
};

// active 는 평상시 상태라 접미사를 붙이지 않는다(셀렉터 밀도 유지). 나머지는 마감/잠금/작성 전 표기.
const statusSuffix = (status: EvaluationPeriodStatus) =>
  status === 'active' ? '' : ` · ${STATUS_LABEL[status]}`;

export const EvaluationPeriodSelector = () => {
  const { periods, selectedPeriodId, selectedPeriod, isLoading, error, setSelectedPeriodId } =
    useEvaluationPeriod();

  if (isLoading) {
    return (
      <div
        style={{
          height: 36,
          width: 220,
          borderRadius: 'var(--r-sm)',
          border: '1px solid var(--border)',
          background: 'var(--bg-muted)',
        }}
      />
    );
  }

  if (!periods.length) {
    // 조회 실패를 '평가기간 없음'으로 위장하지 않는다 — error 면 실패임을 드러낸다.
    return (
      <div
        title={error ?? undefined}
        style={{
          height: 36,
          width: 220,
          borderRadius: 'var(--r-sm)',
          border: '1px solid var(--border)',
          background: 'var(--bg-muted)',
          color: error ? 'var(--danger)' : 'var(--fg-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          fontSize: 'var(--fs-body)',
          fontWeight: 700,
        }}
      >
        <IconCalendar size={15} />
        {error ? '평가기간 불러오기 실패' : '평가기간 없음'}
      </div>
    );
  }

  // 선택된 기간이 active 가 아니면(마감·잠금·작성 전) 트리거 우측에 작은 상태 뱃지를 겹쳐 띄운다.
  const selectedStatus = selectedPeriod && selectedPeriod.status !== 'active' ? selectedPeriod.status : null;
  const badgeStyle = selectedStatus ? STATUS_STYLE[selectedStatus] : null;

  return (
    <label
      style={{
        position: 'relative',
        width: 264,
        flexShrink: 0,
      }}
      title={
        selectedPeriod
          ? `${formatPeriodLabel(selectedPeriod.name, selectedPeriod.evaluation_year)}${statusSuffix(selectedPeriod.status)}`
          : '평가기간'
      }
    >
      <span
        style={{
          position: 'absolute',
          left: 12,
          top: 10,
          color: 'var(--fg-subtle)',
          pointerEvents: 'none',
        }}
      >
        <IconCalendar size={15} />
      </span>
      <select
        className="sd-input"
        value={selectedPeriodId ?? ''}
        onChange={(event) => setSelectedPeriodId(event.target.value || null)}
        aria-label="평가기간 선택"
        style={{
          width: '100%',
          height: 36,
          paddingLeft: 34,
          // 뱃지가 뜨면 선택 텍스트와 겹치지 않도록 우측 여백을 넓힌다.
          paddingRight: selectedStatus ? 84 : 26,
          fontSize: 'var(--fs-sm)',
          fontWeight: 700,
          textOverflow: 'ellipsis',
        }}
      >
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {formatPeriodLabel(period.name, period.evaluation_year)}
            {statusSuffix(period.status)}
          </option>
        ))}
      </select>
      {selectedStatus && badgeStyle && (
        <span
          style={{
            position: 'absolute',
            right: 26,
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: 'var(--r-pill)',
            border: `1px solid ${badgeStyle.border}`,
            background: badgeStyle.bg,
            color: badgeStyle.fg,
            fontSize: 'var(--fs-xs)',
            fontWeight: 800,
            whiteSpace: 'nowrap',
          }}
        >
          {STATUS_LABEL[selectedStatus]}
        </span>
      )}
    </label>
  );
};
