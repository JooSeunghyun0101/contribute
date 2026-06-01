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
}

/**
 * 법인 > 본부 > 부 > 팀 4단계 cascading 필터.
 * 데이터가 없는 레벨(후보 0개)은 자동으로 숨겨 빈 드롭다운을 방지한다.
 * → 조직 계층 값이 채워진 파일을 업로드하기 전까지는 자연스럽게 아무것도 안 보인다.
 */
const OrgFilterBar = ({ items, value, onChange, showReset = true }: OrgFilterBarProps) => {
  const setLevel = (level: OrgLevel, v: string) => {
    const next: OrgFilterState = { ...value };
    if (v === ALL) delete next[level];
    else next[level] = v;
    onChange(pruneOrgFilter(items, next));
  };

  const visibleLevels = ORG_LEVELS.filter(
    (level) => orgOptionsForLevel(items, level, value).length > 0 || Boolean(value[level]),
  );

  if (visibleLevels.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {visibleLevels.map((level) => {
        const options = orgOptionsForLevel(items, level, value);
        return (
          <Select key={level} value={value[level] ?? ALL} onValueChange={(v) => setLevel(level, v)}>
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
