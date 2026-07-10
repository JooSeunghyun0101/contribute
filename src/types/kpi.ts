// 조직 KPI 타입.
// 정량(억/건 등) 목표를 조직 단위로 등록하고 실적을 KPI 에 직접 입력. 트리(parent_kpi_id) 자동 롤업.
// 과업 배분 기능은 2026-07-02 사용자 결정으로 제거 — KPI 는 과업·점수와 분리해 단독 관리.

export type KpiOrgLevel = 'corporation' | 'division' | 'department' | 'team';
export type KpiDirection = 'higher' | 'lower';
export type KpiStatus = 'active' | 'archived';

/** org_kpis 한 행 (+ 서버가 동봉하는 진척 집계). */
export interface OrgKpi {
  id: string;
  evaluation_period_id: string;
  parent_kpi_id: string | null;
  /** 재루팅 등으로 부모가 안 보여도 '어디에 연결됐는지' 표시용(서버 조인). */
  parent_name?: string | null;
  org_level: KpiOrgLevel;
  org_key: string;
  /** 상위 조직 경로 — 동명 조직 구분(레거시 행은 NULL=이름 단독 매칭). */
  org_path_corporation?: string | null;
  org_path_division?: string | null;
  org_path_department?: string | null;
  name: string;
  unit: string;
  target_value: number;
  direction: KpiDirection;
  /** 실적 직접 입력(NULL=미입력) — 폼 프리필용. 롤업 값은 rolled_achieved. */
  achieved_value?: number | null;
  description?: string | null;
  owner_id?: string | null;
  status: KpiStatus;
  created_by: string;
  created_at?: string;
  updated_at?: string;
  // 서버 집계(읽기 전용) — 노드 자체 실적 + 트리 롤업.
  own_achieved?: number;
  rolled_achieved?: number;
  /** 롤업 목표 — 하위 보유 KPI는 하위 목표의 합, 리프는 자체 목표. 표시·진척률의 단일 기준. */
  rolled_target?: number;
  /** direction 반영 진척률(0~1+, 초과 허용). higher=실적/목표, lower=목표/실적(미입력=0). */
  progress?: number;
  /** 실적이 1건이라도 입력됐는가 — lower 방향에서 '미입력'과 '실적 0'을 구분. */
  has_actuals?: boolean;
  /** 요청자가 관리(수정·삭제·하위추가·실적입력)할 수 있는가 — false면 범위 밖 상위 KPI(읽기 전용). */
  can_manage?: boolean;
}

/** 트리 노드 — OrgKpi + 자식. GET /api/org-kpis/tree 응답. */
export interface KpiNode extends OrgKpi {
  children: KpiNode[];
}

export interface OrgKpiInput {
  evaluation_period_id: string;
  parent_kpi_id?: string | null;
  org_level: KpiOrgLevel;
  org_key: string;
  org_path_corporation?: string | null;
  org_path_division?: string | null;
  org_path_department?: string | null;
  name: string;
  unit: string;
  target_value: number;
  direction?: KpiDirection;
  achieved_value?: number | null;
  description?: string | null;
  owner_id?: string | null;
}

/** 정형화 조직 선택지(경로 튜플) — org-options.orgChoices 항목. 레벨까지의 값만 채워지고 나머지는 null. */
export interface KpiOrgChoice {
  corporation: string | null;
  division: string | null;
  department: string | null;
  team: string | null;
  /** 그 조직의 조직장(체인 최상위 평가자) — 없으면 null. */
  leader?: string | null;
  /** 조직장 사번 — 겸직 평가라인(하위 판정)용. */
  leader_id?: string | null;
  /** 조직장의 상향 평가체인(본인 포함, 사번 배열) — 겸직 하위 판정용. */
  chain_up?: string[];
}

export type OrgKpiUpdate = Partial<Omit<OrgKpiInput, 'evaluation_period_id'>> & {
  status?: KpiStatus;
};
