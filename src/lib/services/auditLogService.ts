import { apiFetch } from '@/lib/api';
import { apiErrorHandler } from '@/utils/errorHandler';

/** 감사로그 한 행 — admin_audit_logs + 행위자/대상 이름 조인. previous/new 는 jsonb(형태 가변). */
export type AuditLogRow = {
  id: string;
  action_type: string;
  actor_id: string | null;
  actor_name: string | null;
  target_employee_id: string | null;
  target_employee_name: string | null;
  previous_value: unknown;
  new_value: unknown;
  reason: string | null;
  created_at: string;
};

export type AuditLogQuery = {
  target?: string | null;
  actor?: string | null;
  actionType?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
};

export type AuditLogPage = {
  rows: AuditLogRow[];
  total: number;
  limit: number;
  offset: number;
  actionTypes: string[];
};

export const auditLogService = {
  // HR 전용 감사로그 조회(필터·페이지네이션). 서버가 requireHr 로 강제한다.
  async list(query: AuditLogQuery = {}): Promise<AuditLogPage> {
    try {
      const params = new URLSearchParams();
      if (query.target) params.set('target', query.target);
      if (query.actor) params.set('actor', query.actor);
      if (query.actionType) params.set('actionType', query.actionType);
      if (query.from) params.set('from', query.from);
      if (query.to) params.set('to', query.to);
      if (typeof query.limit === 'number') params.set('limit', String(query.limit));
      if (typeof query.offset === 'number') params.set('offset', String(query.offset));
      const qs = params.toString();
      return await apiFetch<AuditLogPage>(`/api/audit-logs${qs ? `?${qs}` : ''}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
};
