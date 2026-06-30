import { apiFetch } from '@/lib/api';
import type {
  OrgKpi,
  KpiNode,
  OrgKpiInput,
  OrgKpiUpdate,
  TaskKpiAllocation,
  AllocationInput,
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

  /** 폼 드롭다운용 조직 옵션(레벨별) + 요청자 본인 조직. */
  async orgOptions(periodId: string): Promise<{
    corporation: string[];
    division: string[];
    department: string[];
    team: string[];
    mine: { corporation: string | null; division: string | null; department: string | null; team: string | null };
    myTeams: string[];
    manageable: { corporation: string[]; division: string[]; department: string[]; team: string[] };
  }> {
    try {
      return await apiFetch(`/api/org-kpis/org-options${qs({ periodId })}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async get(id: string): Promise<OrgKpi & { allocations: TaskKpiAllocation[]; children: OrgKpi[] }> {
    try {
      return await apiFetch(`/api/org-kpis/${id}`);
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

  /** 평가건에 정렬 가능한 KPI 후보(피평가자 조직 매칭). */
  async candidatesForEvaluation(evaluationId: string): Promise<OrgKpi[]> {
    try {
      return await apiFetch<OrgKpi[]>(`/api/evaluations/${evaluationId}/kpi-candidates`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  /** 과업의 정렬 KPI(배분) 목록. */
  async allocationsByTask(taskId: string): Promise<TaskKpiAllocation[]> {
    try {
      return await apiFetch<TaskKpiAllocation[]>(`/api/tasks/${taskId}/kpi-allocations`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  /** 한 KPI의 과업 배분/실적 upsert(배치). */
  async upsertAllocations(kpiId: string, items: AllocationInput[]): Promise<TaskKpiAllocation[]> {
    try {
      return await apiFetch<TaskKpiAllocation[]>(`/api/org-kpis/${kpiId}/allocations`, {
        method: 'PUT',
        body: JSON.stringify({ allocations: items }),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async removeAllocation(kpiId: string, allocId: string): Promise<void> {
    try {
      await apiFetch(`/api/org-kpis/${kpiId}/allocations/${allocId}`, { method: 'DELETE' });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
};
