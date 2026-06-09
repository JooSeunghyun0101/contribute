import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { notificationService } from '@/lib/services';
import {
  dispatchNotifications,
  type DispatchPayload,
  type DispatchResult,
  type NotificationChannel,
} from '@/lib/notifications/dispatch';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** 미완료 판정: 완료/잠금이 아닌 모든 상태. (reviewStatus 기준) */
const isIncomplete = (record: EmployeeEvaluationRecord): boolean =>
  record.reviewStatus !== 'completed' && record.reviewStatus !== 'locked';

/** 24시간(ms). 동일 평가자 중복 리마인드 가드 윈도. */
const DUP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 중복가드용 reminder 이력을 충분히 확보하기 위한 전역 조회 한도. */
const REMINDER_HISTORY_LIMIT = 200;
/** 대량발송 경고 임계치. */
const MASS_THRESHOLD = 50;

const SENDER_ID = 'system';
const SENDER_NAME = '평가 시스템';

/** 한 평가자(=리마인드 수신자)에 대한 집계 행. */
interface EvaluatorRow {
  evaluatorId: string;
  evaluatorName: string;
  /** 이 평가자가 담당하는 미완료 피평가자 수. */
  incompleteCount: number;
  /** 미완료 피평가자 이름(메시지·표시용). */
  evaluateeNames: string[];
  /** 최근(24h 이내) 리마인드 발송 시각 — 없으면 null. */
  lastReminderAt: string | null;
}

const fmtDateTime = (v: string | null) => {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
};

const buildMessage = (row: EvaluatorRow, periodName: string, endsOn: string | null): string => {
  const deadline = endsOn ? `마감일은 ${endsOn} 입니다.` : '마감일이 설정되어 있습니다.';
  const names =
    row.evaluateeNames.length <= 3
      ? row.evaluateeNames.join(', ')
      : `${row.evaluateeNames.slice(0, 3).join(', ')} 외 ${row.evaluateeNames.length - 3}명`;
  return `[${periodName}] 미완료 평가 ${row.incompleteCount}건이 남아 있습니다 (${names}). ${deadline}`;
};

const RemindersPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { selectedPeriod, selectedPeriodStatus } = useEvaluationPeriod();
  // 미완료 판정은 전사 현황과 동일한 소스 1개만 재사용(per-evaluator 조회 0).
  const { records, isLoading, error } = useCompanyDashboardRecords();

  const periodIsActive = selectedPeriodStatus === 'active';

  // 선택된 수신자(평가자) id 집합.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 24h 이내 reminder 이력: recipientId -> 최근 created_at.
  const [recentReminderAt, setRecentReminderAt] = useState<Map<string, string>>(new Map());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  /** 발송 직전 가드에 쓸 reminder 이력을 전역 1회 조회한다(per-evaluator 아님). */
  const loadReminderHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const all = await notificationService.getNotifications(REMINDER_HISTORY_LIMIT);
      const now = Date.now();
      const map = new Map<string, string>();
      for (const n of all) {
        // 서버 응답은 snake_case 원본. getNotifications 타입은 Notification(@/types, snake_case).
        if (n.notification_type !== 'reminder') continue;
        if (n.sender_id !== SENDER_ID) continue;
        const created = new Date(n.created_at).getTime();
        if (Number.isNaN(created) || now - created > DUP_WINDOW_MS) continue;
        const prev = map.get(n.recipient_id);
        if (!prev || new Date(prev).getTime() < created) {
          map.set(n.recipient_id, n.created_at);
        }
      }
      setRecentReminderAt(map);
    } catch {
      // 이력 조회 실패 시 가드는 비활성(빈 맵) — 발송 자체는 막지 않되 경고는 사라진다.
      setRecentReminderAt(new Map());
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // 페이지 마운트/레코드 변경 시 이력만 로드한다. 발송은 절대 자동 실행하지 않는다.
  useEffect(() => {
    if (isLoading) return;
    void loadReminderHistory();
  }, [isLoading, loadReminderHistory]);

  // 미완료 피평가자를 평가자(수신자)별로 집계. 이미 로드된 records 만 사용.
  const rows = useMemo<EvaluatorRow[]>(() => {
    const byEvaluator = new Map<string, EvaluatorRow>();
    for (const record of records) {
      if (!isIncomplete(record)) continue;
      const evaluatorId =
        record.evaluation?.evaluator_id ?? record.employee.evaluator_id ?? null;
      if (!evaluatorId) continue; // 평가자 미배정 → 보낼 대상 없음.
      const evaluatorName =
        record.evaluation?.evaluator_name ?? `평가자 ${evaluatorId}`;
      const existing = byEvaluator.get(evaluatorId);
      if (existing) {
        existing.incompleteCount += 1;
        existing.evaluateeNames.push(record.employee.name);
      } else {
        byEvaluator.set(evaluatorId, {
          evaluatorId,
          evaluatorName,
          incompleteCount: 1,
          evaluateeNames: [record.employee.name],
          lastReminderAt: null,
        });
      }
    }
    const list = [...byEvaluator.values()].map((row) => ({
      ...row,
      lastReminderAt: recentReminderAt.get(row.evaluatorId) ?? null,
    }));
    list.sort((a, b) => b.incompleteCount - a.incompleteCount);
    return list;
  }, [records, recentReminderAt]);

  const selectableIds = useMemo(() => rows.map((r) => r.evaluatorId), [rows]);

  const toggle = (evaluatorId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(evaluatorId)) next.delete(evaluatorId);
      else next.add(evaluatorId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) =>
      prev.size === selectableIds.length ? new Set() : new Set(selectableIds),
    );
  };

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedIds.has(r.evaluatorId)),
    [rows, selectedIds],
  );

  // 24h 이내 이미 발송된 선택 대상(중복가드 대상) — 발송에서 제외된다.
  const alreadySentRows = useMemo(
    () => selectedRows.filter((r) => r.lastReminderAt !== null),
    [selectedRows],
  );
  const sendableRows = useMemo(
    () => selectedRows.filter((r) => r.lastReminderAt === null),
    [selectedRows],
  );

  const canOpenConfirm =
    periodIsActive && selectedRows.length > 0 && !sending && !isLoading && !historyLoading;

  const handleConfirmSend = async () => {
    if (!user) return;
    setConfirmOpen(false);
    setSending(true);
    try {
      // 가드 직전 이력을 한 번 더 새로고침(전역 1회) — 다른 세션 발송분 반영.
      await loadReminderHistory();

      // recipientId Set 으로 유일화 + 24h 이내 발송분 제외. period 미선택 시 차단.
      const period = selectedPeriod;
      if (!period) {
        toast({
          title: '평가기간을 선택하세요',
          description: '발송할 평가기간이 선택되지 않았습니다.',
          variant: 'destructive',
        });
        return;
      }

      const seen = new Set<string>();
      const targets = sendableRows.filter((r) => {
        if (seen.has(r.evaluatorId)) return false;
        seen.add(r.evaluatorId);
        return true;
      });

      if (targets.length === 0) {
        toast({
          title: '발송할 대상이 없습니다',
          description: '선택한 평가자는 모두 24시간 이내에 이미 발송되었습니다.',
        });
        return;
      }

      const payloads: DispatchPayload[] = targets.map((row) => ({
        notification_type: 'reminder',
        title: '평가 진행 리마인드',
        message: buildMessage(row, period.name, period.ends_on),
        priority: 'medium',
        sender_id: SENDER_ID,
        sender_name: SENDER_NAME,
        recipient_id: row.evaluatorId,
        related_evaluation_id: null,
        related_task_id: null,
        is_read: false,
      }));

      const channels: NotificationChannel[] = ['inApp', 'email'];
      const results = await dispatchNotifications(payloads, channels);

      // inApp 채널 기준으로 평가자별 성패 집계(email 은 skipped 고정).
      const inApp = results.filter((r) => r.channel === 'inApp');
      const sent = inApp.filter((r) => r.outcome === 'sent');
      const failed = inApp.filter((r) => r.outcome === 'failed');
      const skipped = results.filter((r) => r.channel === 'email').length;

      const nameOf = (recipientId: string) =>
        targets.find((t) => t.evaluatorId === recipientId)?.evaluatorName ?? recipientId;

      const failDetail =
        failed.length > 0
          ? ` 실패: ${failed.map((f) => `${nameOf(f.recipientId)}(${f.reason ?? '오류'})`).join(', ')}`
          : '';

      toast({
        title: '리마인드 발송 결과',
        description: `성공 ${sent.length} · 건너뜀(이메일 미설정) ${skipped} · 실패 ${failed.length}.${failDetail}`,
        variant: failed.length > 0 ? 'destructive' : undefined,
      });

      // 발송 후 선택 해제 + 이력 재로드(최근 발송시각 갱신).
      setSelectedIds(new Set());
      await loadReminderHistory();
    } catch (err) {
      toast({
        title: '발송 실패',
        description: err instanceof Error ? err.message : '리마인드를 발송하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const totalIncomplete = useMemo(
    () => rows.reduce((sum, r) => sum + r.incompleteCount, 0),
    [rows],
  );

  return (
    <div>
      <PageHeader
        title="독려·리마인드 센터"
        subtitle="미완료 평가가 남은 평가자에게 인앱 리마인드를 발송합니다. 발송은 선택·확인 후에만 진행됩니다."
        actions={
          <button
            className="sd-btn sd-btn-outline sd-btn-sm"
            onClick={() => void loadReminderHistory()}
            disabled={isLoading || historyLoading || sending}
          >
            {historyLoading ? '불러오는 중…' : '새로고침'}
          </button>
        }
      />

      <div style={{ padding: '20px 32px' }}>
        {!periodIsActive && (
          <div
            className="sd-card"
            style={{
              padding: 16,
              marginBottom: 16,
              background: 'var(--ok-orange-50)',
              color: 'var(--ok-orange)',
              fontWeight: 600,
            }}
          >
            선택한 평가기간이 진행중(active) 상태가 아니므로 리마인드를 발송할 수 없습니다.
          </div>
        )}

        <div
          className="sd-card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: 16,
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
            미완료 평가자 <strong style={{ color: 'var(--fg)' }}>{rows.length}</strong>명 · 미완료
            평가 <strong style={{ color: 'var(--fg)' }}>{totalIncomplete}</strong>건 · 선택{' '}
            <strong style={{ color: 'var(--ok-orange)' }}>{selectedRows.length}</strong>명
          </div>
          <button
            className="sd-btn sd-btn-primary sd-btn-sm"
            disabled={!canOpenConfirm}
            onClick={() => setConfirmOpen(true)}
          >
            {sending ? '발송 중…' : `선택한 ${selectedRows.length}명에게 리마인드 발송`}
          </button>
        </div>

        <div className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
          {isLoading ? (
            <div style={{ color: 'var(--fg-muted)', padding: 24 }}>불러오는 중…</div>
          ) : error ? (
            <div style={{ color: 'var(--danger)', padding: 24 }}>{error}</div>
          ) : rows.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', padding: 24 }}>
              미완료 평가가 남은 평가자가 없습니다.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-body)' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={th}>
                      <input
                        type="checkbox"
                        aria-label="전체 선택"
                        checked={selectedIds.size > 0 && selectedIds.size === selectableIds.length}
                        onChange={toggleAll}
                        disabled={sending || !periodIsActive}
                      />
                    </th>
                    <th style={th}>평가자</th>
                    <th style={th}>미완료</th>
                    <th style={th}>대상 피평가자</th>
                    <th style={th}>최근 발송(24h)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const checked = selectedIds.has(row.evaluatorId);
                    const recentlySent = row.lastReminderAt !== null;
                    return (
                      <tr key={row.evaluatorId}>
                        <td style={td}>
                          <input
                            type="checkbox"
                            aria-label={`${row.evaluatorName} 선택`}
                            checked={checked}
                            onChange={() => toggle(row.evaluatorId)}
                            disabled={sending || !periodIsActive}
                          />
                        </td>
                        <td style={td}>
                          <strong>{row.evaluatorName}</strong>
                          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
                            {row.evaluatorId}
                          </div>
                        </td>
                        <td style={td}>
                          <span style={{ fontWeight: 700 }}>{row.incompleteCount}</span>건
                        </td>
                        <td style={{ ...td, maxWidth: 280, whiteSpace: 'normal', color: 'var(--fg-muted)' }}>
                          {row.evaluateeNames.slice(0, 5).join(', ')}
                          {row.evaluateeNames.length > 5
                            ? ` 외 ${row.evaluateeNames.length - 5}명`
                            : ''}
                        </td>
                        <td style={td}>
                          {recentlySent ? (
                            <span style={{ color: 'var(--ok-orange)', fontWeight: 600 }}>
                              {fmtDateTime(row.lastReminderAt)} (제외)
                            </span>
                          ) : (
                            <span style={{ color: 'var(--fg-muted)' }}>-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !sending && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>리마인드 발송 확인</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span>
                  선택한 <strong>{selectedRows.length}</strong>명 중{' '}
                  <strong>{sendableRows.length}</strong>명에게 인앱 리마인드를 발송합니다 (이메일:
                  미설정).
                </span>
                {alreadySentRows.length > 0 && (
                  <span style={{ color: 'var(--ok-orange)' }}>
                    {alreadySentRows[0].evaluatorName}
                    {alreadySentRows.length > 1 ? ` 외 ${alreadySentRows.length - 1}명` : ''} 24시간 이내
                    이미 발송됨 — 제외됩니다.
                  </span>
                )}
                {sendableRows.length > MASS_THRESHOLD && (
                  <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                    주의: {sendableRows.length}명에게 한 번에 발송하는 대량 발송입니다. 대상을 다시
                    확인하세요.
                  </span>
                )}
                {sendableRows.length === 0 && (
                  <span style={{ color: 'var(--danger)' }}>
                    발송 가능한 대상이 없습니다(모두 24시간 이내 발송됨).
                  </span>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmSend();
              }}
              disabled={sending || sendableRows.length === 0}
            >
              {sending ? '발송 중…' : `${sendableRows.length}명에게 발송`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const th: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 700,
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
};

const td: CSSProperties = {
  padding: '12px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
  whiteSpace: 'nowrap',
};

export default RemindersPage;
