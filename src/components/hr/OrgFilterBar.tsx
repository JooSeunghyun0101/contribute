import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ORG_LEVELS,
  ORG_LEVEL_LABELS,
  hasActiveOrgFilter,
  orgOptionsForLevel,
  pruneOrgFilter,
  selectedOrgValues,
  type OrgFields,
  type OrgFilterState,
  type OrgLevel,
} from '@/lib/orgHierarchy';

const ALL = '__all__';

interface OrgFilterBarProps {
  /** 필터 후보를 뽑을 대상(직원 등). org_* 필드를 가진 객체. */
  items: OrgFields[];
  value: OrgFilterState;
  onChange: (next: OrgFilterState) => void;
  /** 초기화 버튼 표시 여부 */
  showReset?: boolean;
  /** 같은 레벨에서 여러 값을 중복 선택(필터처럼). 기본 false(단일 select, 하위호환). */
  multiSelect?: boolean;
}

/**
 * 법인 > 본부 > 부 > 팀 4단계 cascading 필터.
 * 데이터가 없는 레벨(후보 0개)은 자동으로 숨겨 빈 드롭다운을 방지한다.
 * multiSelect=true 면 각 레벨에서 여러 값을 칩으로 중복 선택할 수 있다
 * (조직은 달라도 실질 같은 역할의 부서들을 함께 조회/검토).
 */
const OrgFilterBar = ({
  items,
  value,
  onChange,
  showReset = true,
  multiSelect = false,
}: OrgFilterBarProps) => {
  const setSingle = (level: OrgLevel, v: string) => {
    const next: OrgFilterState = { ...value };
    if (v === ALL) delete next[level];
    else next[level] = v;
    onChange(pruneOrgFilter(items, next));
  };

  const addMulti = (level: OrgLevel, v: string) => {
    if (v === ALL) return;
    const cur = selectedOrgValues(value[level]);
    if (cur.includes(v)) return;
    onChange(pruneOrgFilter(items, { ...value, [level]: [...cur, v] }));
  };

  const removeMulti = (level: OrgLevel, v: string) => {
    const cur = selectedOrgValues(value[level]).filter((x) => x !== v);
    const next: OrgFilterState = { ...value };
    if (cur.length === 0) delete next[level];
    else next[level] = cur;
    onChange(pruneOrgFilter(items, next));
  };

  const visibleLevels = ORG_LEVELS.filter(
    (level) =>
      orgOptionsForLevel(items, level, value).length > 0 ||
      selectedOrgValues(value[level]).length > 0,
  );

  if (visibleLevels.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {visibleLevels.map((level) => {
        const options = orgOptionsForLevel(items, level, value);

        if (!multiSelect) {
          const single = selectedOrgValues(value[level])[0] ?? ALL;
          return (
            <Select key={level} value={single} onValueChange={(v) => setSingle(level, v)}>
              <SelectTrigger style={{ width: 150, height: 36 }}>
                <SelectValue placeholder={ORG_LEVEL_LABELS[level]} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{ORG_LEVEL_LABELS[level]} 전체</SelectItem>
                {options.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }

        // 다중 선택: 선택값 칩 + "추가" select
        const selected = selectedOrgValues(value[level]);
        const addable = options.filter((o) => !selected.includes(o));
        return (
          <div key={level} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {selected.map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => removeMulti(level, val)}
                title={`${ORG_LEVEL_LABELS[level]} 선택 해제`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  height: 32,
                  padding: '0 10px',
                  borderRadius: 8,
                  border: '1px solid var(--ok-orange-100)',
                  background: 'var(--ok-orange-50)',
                  color: 'var(--ok-brown)',
                  fontSize: 'var(--fs-sm)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {val} ✕
              </button>
            ))}
            {addable.length > 0 && (
              <Select value={ALL} onValueChange={(v) => addMulti(level, v)}>
                <SelectTrigger style={{ width: 150, height: 36 }}>
                  <SelectValue
                    placeholder={selected.length ? `${ORG_LEVEL_LABELS[level]} 추가` : ORG_LEVEL_LABELS[level]}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {ORG_LEVEL_LABELS[level]}
                    {selected.length ? ' 추가…' : ' 전체'}
                  </SelectItem>
                  {addable.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      })}
      {showReset && hasActiveOrgFilter(value) && (
        <button
          type="button"
          onClick={() => onChange({})}
          style={{
            height: 36,
            padding: '0 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--fg-muted)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          초기화
        </button>
      )}
    </div>
  );
};

export default OrgFilterBar;
