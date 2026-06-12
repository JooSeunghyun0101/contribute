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

/** 한 레벨의 선택값. 단일(string) 또는 다중(string[]). */
export type OrgSelection = string | string[];

/** 선택된 계층 필터 상태. 비어있으면 전체. */
export type OrgFilterState = Partial<Record<OrgLevel, OrgSelection>>;

/** 선택값을 배열로 정규화(단일/다중/빈값 모두 처리). */
export const selectedOrgValues = (sel: OrgSelection | undefined): string[] => {
  if (sel == null) return [];
  const arr = Array.isArray(sel) ? sel : [sel];
  return arr.filter(Boolean);
};

export const emptyOrgFilter = (): OrgFilterState => ({});

export const hasActiveOrgFilter = (filter: OrgFilterState): boolean =>
  ORG_LEVELS.some((level) => selectedOrgValues(filter[level]).length > 0);

/** 한 항목이 현재 필터(상위~하위 모든 선택값)에 부합하는지. 같은 레벨 내 다중 선택은 OR. */
export const matchesOrgFilter = (item: OrgFields, filter: OrgFilterState): boolean =>
  ORG_LEVELS.every((level) => {
    const vals = selectedOrgValues(filter[level]);
    return vals.length === 0 || vals.includes(getOrgValue(item, level));
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
      const vals = selectedOrgValues(filter[h]);
      return vals.length === 0 || vals.includes(getOrgValue(item, h));
    });
    if (!okHigher) continue;
    const v = getOrgValue(item, level);
    if (v) values.add(v);
  }
  return [...values].sort((a, b) => a.localeCompare(b, 'ko'));
};

/**
 * 상위 레벨 선택이 바뀌면 더 이상 유효하지 않은 하위 선택을 제거한다.
 * (예: 본부를 바꾸면 기존 부/팀 선택 해제) 다중 선택은 유효한 값만 남긴다.
 */
export const pruneOrgFilter = (
  items: OrgFields[],
  filter: OrgFilterState,
): OrgFilterState => {
  const next: OrgFilterState = {};
  for (const level of ORG_LEVELS) {
    const vals = selectedOrgValues(filter[level]);
    if (vals.length === 0) continue;
    const options = orgOptionsForLevel(items, level, next);
    const validVals = vals.filter((v) => options.includes(v));
    if (validVals.length === 1) next[level] = validVals[0];
    else if (validVals.length > 1) next[level] = validVals;
  }
  return next;
};

/** 사람이 읽을 수 있는 경로 문자열. 예: "OK홀딩스 > 경영지원본부 > 인사부 > 인사팀" */
export const orgPathLabel = (item: OrgFields): string =>
  ORG_LEVELS.map((level) => getOrgValue(item, level))
    .filter(Boolean)
    .join(' › ');

// ─────────────────────────────────────────────────────────────
// 평탄한 조직 노드 모델 (레벨을 섞어 여러 부서를 동시 선택할 때 사용).
// cascading 필터(OrgFilterState)는 레벨 내 OR·레벨 간 AND라
// "OK›인사팀 + OKH›인사팀 + OKH›AX›인사부"처럼 서로 다른 가지의
// 부서들을 한꺼번에 고를 수 없다. 각 노드를 '완전한 경로' 한 개로
// 평탄화해 체크박스로 OR 선택한다.
// ─────────────────────────────────────────────────────────────

/** 평탄한 조직 노드(모든 깊이). 각 노드 = 루트~해당 깊이까지의 값 경로. */
export interface OrgNode {
  /** 값들을 구분자로 이은 식별자(선택 상태 저장용). */
  key: string;
  /** 사람이 읽는 경로. 예: "OKH › AX › 인사부" */
  label: string;
  /** 마지막 레벨 값. 예: "인사부" */
  leaf: string;
  /** 1=법인 … 4=팀 */
  depth: number;
}

// 값 안에 나타날 일이 없는 제어문자를 키 구분자로 사용.
const ORG_KEY_SEP = '␟';

export const orgNodeKey = (values: string[]): string => values.join(ORG_KEY_SEP);

/** 노드 key 를 값 배열로 되돌린다. */
export const orgNodeValues = (key: string): string[] => key.split(ORG_KEY_SEP);

/**
 * 직원의 '압축 경로' — 빈 레벨을 건너뛴, 비어있지 않은 조직값 배열.
 * 예) 법인=OK, 본부=(없음), 부=준법지원부, 팀=준법지원팀 → ['OK','준법지원부','준법지원팀'].
 * 계층에 구멍이 있어도(본부 누락 등) 모든 부/팀이 노드·매칭에 잡히게 한다.
 */
export const orgCompactPath = (item: OrgFields): string[] =>
  ORG_LEVELS.map((level) => getOrgValue(item, level)).filter(Boolean);

/** items 에 등장하는 모든 조직 노드(압축경로 기준, 중복 제거, 경로순 정렬). */
export const orgNodes = (items: OrgFields[]): OrgNode[] => {
  const map = new Map<string, OrgNode>();
  for (const item of items) {
    const acc: string[] = [];
    for (const v of orgCompactPath(item)) {
      acc.push(v);
      const key = orgNodeKey(acc);
      if (!map.has(key)) {
        map.set(key, { key, label: acc.join(' › '), leaf: v, depth: acc.length });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
};

/**
 * item 이 선택된 조직 노드 중 하나의 '하위(또는 자신)'인지. 빈 선택=전체 통과.
 * 각 노드는 압축경로이고, 선택 = 그 단위 하위 전원(subtree, OR). 노드의 경로가
 * 직원 압축경로의 접두면 매칭 → 법인/본부/부/팀 어느 레벨을 골라도 그 아래 전원이 나온다.
 */
export const matchesOrgNodes = (item: OrgFields, selectedKeys: string[]): boolean => {
  if (selectedKeys.length === 0) return true;
  const path = orgCompactPath(item);
  return selectedKeys.some((key) => {
    const vals = orgNodeValues(key);
    return vals.every((v, i) => path[i] === v);
  });
};
