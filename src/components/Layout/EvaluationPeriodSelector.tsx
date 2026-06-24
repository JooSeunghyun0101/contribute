import { IconCalendar } from '@/components/brand';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';

// 이름에 이미 연도가 들어있으면(예: "2025 Annual Evaluation") 연도를 중복 표기하지 않는다.
const formatPeriodLabel = (name: string, year: number) =>
  name.includes(String(year)) ? name : `${name} · ${year}`;

export const EvaluationPeriodSelector = () => {
  const { periods, selectedPeriodId, selectedPeriod, isLoading, setSelectedPeriodId } = useEvaluationPeriod();

  if (isLoading) {
    return (
      <div
        style={{
          height: 36,
          width: 220,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-muted)',
        }}
      />
    );
  }

  if (!periods.length) {
    return (
      <div
        style={{
          height: 36,
          width: 220,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-muted)',
          color: 'var(--fg-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          fontSize: 'var(--fs-body)',
          fontWeight: 700,
        }}
      >
        <IconCalendar size={15} />
        평가기간 없음
      </div>
    );
  }

  return (
    <label
      style={{
        position: 'relative',
        width: 264,
        flexShrink: 0,
      }}
      title={selectedPeriod ? formatPeriodLabel(selectedPeriod.name, selectedPeriod.evaluation_year) : '평가기간'}
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
          paddingRight: 26,
          fontSize: 'var(--fs-sm)',
          fontWeight: 700,
          textOverflow: 'ellipsis',
        }}
      >
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {formatPeriodLabel(period.name, period.evaluation_year)}
          </option>
        ))}
      </select>
    </label>
  );
};
