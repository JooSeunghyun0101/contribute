// 4단계 조직 계층(법인 > 본부 > 부 > 팀) 공용 정의·필터 헬퍼.
// 업로드 양식의 법인/본부/부/팀 컬럼을 employees.org_* 로 보존하고,
// 화면별 계층 필터(상위 선택에 따라 하위 후보가 좁혀지는 cascading)를 한 곳에서 처리한다.

export const ORG_LEVELS = ['corporation', 'division', 'department', 'team'] as const;
export type OrgLevel = (typeof ORG_LEVELS)[number];

export const ORG_LEVEL_LABELS: Record<OrgLevel, string> = {
  corporation: '법인',
  division: '본부',
  department: '부',
  team: '팀',
};

/** 조직 계층 값을 담는 객체(Employee·import row 등에 spread). DB 컬럼명과 일치. */
export interface OrgFields {
  org_corporation?: string | null;
  org_division?: string | null;
  org_department?: string | null;
  org_team?: string | null;
}

export const ORG_FIELD: Record<OrgLevel, keyof OrgFields> = {
  corporation: 'org_corporation',
  division: 'org_division',
  department: 'org_department',
  team: 'org_team',
};

/** 업로드 양식 한글 헤더 → org 레벨. 파서에서 사용. */
export const ORG_HEADER_TO_LEVEL: Record<string, OrgLevel> = {
  법인: 'corporation',
  본부: 'division',
  부: 'department',
  팀: 'team',
};

export const getOrgValue = (item: OrgFields | null | undefined, level: OrgLevel): string => {
  if (!item) return '';
  const v = item[ORG_FIELD[level]];
  if (v == null) return '';
  const s = String(v).trim();
  // 업로드 양식은 빈 계층을 "-" 로 표기 → 값 없음으로 취급.
  return s === '-' ? '' : s;
};

/** 선택된 계층 필터 상태. 비어있으면 전체. */
export type OrgFilterState = Partial<Record<OrgLevel, string>>;

export const emptyOrgFilter = (): OrgFilterState => ({});

export const hasActiveOrgFilter = (filter: OrgFilterState): boolean =>
  ORG_LEVELS.some((level) => Boolean(filter[level]));

/** 한 항목이 현재 필터(상위~하위 모든 선택값)에 부합하는지. */
export const matchesOrgFilter = (item: OrgFields, filter: OrgFilterState): boolean =>
  ORG_LEVELS.every((level) => {
    const selected = filter[level];
    return !selected || getOrgValue(item, level) === selected;
  });

/**
 * 특정 레벨에서 고를 수 있는 후보 목록.
 * 자기보다 상위 레벨의 선택값과 부합하는 항목들에서만 distinct 값을 뽑는다(cascading).
 */
export const orgOptionsForLevel = (
  items: OrgFields[],
  level: OrgLevel,
  filter: OrgFilterState,
): string[] => {
  const levelIdx = ORG_LEVELS.indexOf(level);
  const higher = ORG_LEVELS.slice(0, levelIdx);
  const values = new Set<string>();
  for (const item of items) {
    const okHigher = higher.every((h) => {
      const sel = filter[h];
      return !sel || getOrgValue(item, h) === sel;
    });
    if (!okHigher) continue;
    const v = getOrgValue(item, level);
    if (v) values.add(v);
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'ko'));
};

/**
 * 상위 레벨 선택이 바뀌면 더 이상 유효하지 않은 하위 선택을 제거한다.
 * (예: 본부를 바꾸면 기존 부/팀 선택 해제)
 */
export const pruneOrgFilter = (
  items: OrgFields[],
  filter: OrgFilterState,
): OrgFilterState => {
  const next: OrgFilterState = {};
  for (const level of ORG_LEVELS) {
    const sel = filter[level];
    if (!sel) continue;
    const valid = orgOptionsForLevel(items, level, next).includes(sel);
    if (valid) next[level] = sel;
  }
  return next;
};

/** 사람이 읽을 수 있는 경로 문자열. 예: "OK홀딩스 > 경영지원본부 > 인사부 > 인사팀" */
export const orgPathLabel = (item: OrgFields): string =>
  ORG_LEVELS.map((level) => getOrgValue(item, level))
    .filter(Boolean)
    .join(' › ');
