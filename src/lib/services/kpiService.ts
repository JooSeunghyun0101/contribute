import { apiFetch } from '@/lib/api';
import type {
  OrgKpi,
  KpiNode,
  KpiOrgChoice,
  KpiOrgLevel,
  OrgKpiInput,
  OrgKpiUpdate,
} from '@/types/kpi';
import { apiErrorHandler } from '@/utils/errorHandler';

const qs = (params: Record<string, string | null | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const kpiService = {
  /** KPI 목록(평면) — own/rolled/progress 집계 동봉. */
  async list(params: {
    periodId: string;
    level?: string;
    orgKey?: string;
  }): Promise<OrgKpi[]> {
    try {
      return await apiFetch<OrgKpi[]>(
        `/api/org-kpis${qs({ periodId: params.periodId, level: params.level, orgKey: params.orgKey })}`,
      );
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  /** 트리 구조(children 중첩) + 롤업 진척. */
  async tree(periodId: string): Promise<KpiNode[]> {
    try {
      return await apiFetch<KpiNode[]>(`/api/org-kpis/tree${qs({ periodId })}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  /** 폼 드롭다운용 조직 옵션(레벨별) + 요청자 본인 조직 + 조직장 라벨 + 정형화 경로 튜플(orgChoices). */
  async orgOptions(periodId: string): Promise<{
    corporation: string[];
    division: string[];
    department: string[];
    team: string[];
    mine: { corporation: string | null; division: string | null; department: string | null; team: string | null };
    myTeams: string[];
    manageable: { corporation: string[]; division: string[]; department: string[]; team: string[] };
    /** 레벨별 { 경로키(법인|본부|부|팀, 레벨까지 '|' 연결): 조직장 이름[] } — 체인 최상위 우선. */
    leaders: Record<KpiOrgLevel, Record<string, string[]>>;
    /** 정형화 조직 선택지 — 평가자 탭=평가대상 전원이 내 하향 체인인 조직만, HR 관리자 탭=전체. */
    orgChoices: Record<KpiOrgLevel, KpiOrgChoice[]>;
    /** 적용된 범위 규칙 — 배너 안내용. all=HR 관리자 탭(전사), chain=평가자 탭(내 체인). */
    scopeInfo: { mode: 'all' | 'chain' };
  }> {
    try {
      return await apiFetch(`/api/org-kpis/org-options${qs({ periodId })}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async create(input: OrgKpiInput): Promise<OrgKpi> {
    try {
      return await apiFetch<OrgKpi>('/api/org-kpis', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async update(id: string, updates: OrgKpiUpdate): Promise<OrgKpi> {
    try {
      return await apiFetch<OrgKpi>(`/api/org-kpis/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async remove(id: string): Promise<void> {
    try {
      await apiFetch(`/api/org-kpis/${id}`, { method: 'DELETE' });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  /** 상위 KPI 연결 후보 — 조직 상위 경로 + 겸직 평가라인 상위의 같은 단위 KPI(가시성 무관). */
  async parentCandidates(params: {
    periodId: string;
    orgLevel: KpiOrgLevel;
    unit: string;
    corporation?: string | null;
    division?: string | null;
    department?: string | null;
    /** 이 KPI 조직 자체의 이름 — 겸직 평가라인 상위 후보 산정용(없으면 경로 후보만). */
    orgKey?: string | null;
  }): Promise<OrgKpi[]> {
    try {
      return await apiFetch<OrgKpi[]>(
        `/api/org-kpis/parent-candidates${qs({
          periodId: params.periodId,
          orgLevel: params.orgLevel,
          unit: params.unit,
          corporation: params.corporation,
          division: params.division,
          department: params.department,
          orgKey: params.orgKey,
        })}`,
      );
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

};
