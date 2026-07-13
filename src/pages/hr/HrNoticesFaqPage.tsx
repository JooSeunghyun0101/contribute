import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import PageHeader from '@/components/Layout/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/state-views';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationPeriod } from '@/contexts/EvaluationPeriodContext';
import { useCompanyDashboardRecords } from '@/hooks/useDashboardRecords';
import { notificationService, settingService } from '@/lib/services';
import {
  dispatchNotifications,
  type DispatchPayload,
  type NotificationChannel,
} from '@/lib/notifications/dispatch';
import type { EmployeeEvaluationRecord } from '@/lib/dashboardData';
import {
  matchesOrgNodes,
  type OrgFields,
} from '@/lib/orgHierarchy';
import OrgChecklist from '@/components/hr/OrgChecklist';
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

/* ────────────────────────────────────────────────────────────────────────
 * 공지 발송 상수
 * 리마인드(F-C1)와 도메인 격리를 위해 notification_type='notice' 로 보낸다.
 * 'reminder' 재사용 시 24h 중복가드가 두 도메인 사이에서 교차 오작동하므로 금지.
 * ────────────────────────────────────────────────────────────────────── */

/** 24시간(ms). 동일 수신자 중복 공지 가드 윈도. */
const DUP_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * 공지 중복가드용 이력 조회 한도.
 * getNotifications 는 전체를 DESC limit 으로 가져온 뒤 클라이언트에서 type 필터링한다.
 * ⚠ server.js POST 한도가 Math.min(limit, 200) 이라 200 초과는 무음 절단됨 → 서버 캡과 일치하는 200으로 둔다.
 * (24h 윈도 + 발송 직전 재조회로 보강하며, 최근 공지 200건이면 윈도 안에 든다.)
 */
const NOTICE_HISTORY_LIMIT = 200;
/** 대량발송 경고 임계치. */
const MASS_THRESHOLD = 50;

const SENDER_ID = 'system';
const SENDER_NAME = 'HR';

/** 수신자 범위 선택지. */
type AudienceKey = 'evaluators' | 'evaluatees';

const AUDIENCE_LABEL: Record<AudienceKey, string> = {
  evaluators: '평가 배정된 평가자',
  evaluatees: '평가 대상 피평가자',
};

/** FAQ 항목. settings(JSONB)에 배열로 저장된다. */
interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

/** settings.setting_data 에 저장되는 FAQ 카탈로그 형태. */
interface FaqCatalog {
  faqs: FaqItem[];
}

const FAQ_SETTING_USER = 'system';
const FAQ_SETTING_TYPE = 'faq_catalog';

// 동시편집 감지용 정규화 — id 는 무시하고 질문/답변 내용을 순서대로 비교(공백 정리).
// 재정렬·수정·추가·삭제를 모두 '변경'으로 감지한다.
const normalizeFaqCatalog = (list: ReadonlyArray<{ question?: unknown; answer?: unknown }>): string =>
  JSON.stringify(
    (Array.isArray(list) ? list : []).map((f) => ({
      q: typeof f.question === 'string' ? f.question.trim() : '',
      a: typeof f.answer === 'string' ? f.answer.trim() : '',
    })),
  );

/** 한 명의 발송 후보(수신자). */
interface RecipientRow {
  /** employee_id (실제 직원 식별자). 발송 recipient_id 로 사용. */
  id: string;
  name: string;
  org: OrgFields;
  /** 최근(24h 이내) 공지 발송 시각 — 없으면 null. */
  lastNoticeAt: string | null;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `faq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

// 대상자 검색용 — 이름 외에 소속(법인·본부·부·팀)도 매칭한다. 부서 컬럼 표시는 '부 · 팀'.
const orgSearchText = (o: OrgFields) =>
  [o.org_corporation, o.org_division, o.org_department, o.org_team].filter(Boolean).join(' ');
const orgDeptLabel = (o: OrgFields) =>
  [o.org_department, o.org_team].filter(Boolean).join(' · ') || '-';

const HrNoticesFaqPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { selectedPeriod } = useEvaluationPeriod();
  // 수신자 후보는 전사 현황과 동일 소스 1개만 재사용(per-employee 조회 0 — 폭주 금지).
  const { records, isLoading, error } = useCompanyDashboardRecords();

  /* ── 공지 발송 상태 ─────────────────────────────────────────────── */
  const [audience, setAudience] = useState<AudienceKey>('evaluators');
  const [orgFilter, setOrgFilter] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 24h 이내 notice 이력: recipientId -> 최근 created_at.
  const [recentNoticeAt, setRecentNoticeAt] = useState<Map<string, string>>(new Map());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  /* ── 탭: 공지 발송 / 공통 FAQ ───────────────────────────────────── */
  const [tab, setTab] = useState<'notice' | 'faq'>('notice');

  /* ── FAQ 상태 ───────────────────────────────────────────────────── */
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  // 로드 시점의 서버 FAQ 스냅샷(정규화) — 저장 직전 재조회본과 비교해 동시편집을 감지한다.
  const baselineFaqRef = useRef<string>('');
  const [faqLoading, setFaqLoading] = useState(true);
  const [faqError, setFaqError] = useState(false);
  const [faqSaving, setFaqSaving] = useState(false);

  /**
   * 발송 직전 가드에 쓸 notice 이력을 전역 1회 조회한다(per-recipient 아님).
   * type==='notice' && sender==='system' 만 집계해 리마인드와 격리한다.
   */
  const loadNoticeHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const all = await notificationService.getNotifications(NOTICE_HISTORY_LIMIT);
      const now = Date.now();
      const map = new Map<string, string>();
      for (const n of all) {
        // 서버 응답은 snake_case 원본. notification_type 분기로 reminder 와 격리.
        if (n.notification_type !== 'notice') continue;
        if (n.sender_id !== SENDER_ID) continue;
        const created = new Date(n.created_at).getTime();
        if (Number.isNaN(created) || now - created > DUP_WINDOW_MS) continue;
        const prev = map.get(n.recipient_id);
        if (!prev || new Date(prev).getTime() < created) {
          map.set(n.recipient_id, n.created_at);
        }
      }
      setRecentNoticeAt(map);
    } catch {
      // 이력 조회 실패 시 가드는 비활성(빈 맵) — 발송 자체는 막지 않되 경고는 사라진다.
      setRecentNoticeAt(new Map());
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadFaqs = useCallback(async () => {
    setFaqLoading(true);
    setFaqError(false);
    try {
      const setting = await settingService.getUserSetting(FAQ_SETTING_USER, FAQ_SETTING_TYPE);
      const data = setting?.setting_data as Partial<FaqCatalog> | null | undefined;
      const list = Array.isArray(data?.faqs) ? data.faqs : [];
      baselineFaqRef.current = normalizeFaqCatalog(list);
      setFaqs(
        list.map((f) => ({
          id: typeof f.id === 'string' && f.id ? f.id : newId(),
          question: typeof f.question === 'string' ? f.question : '',
          answer: typeof f.answer === 'string' ? f.answer : '',
        })),
      );
    } catch {
      // P3-9: 로드 실패를 '등록된 FAQ 없음'으로 위장하지 않는다 — 빈 목록인 줄 알고
      // 편집·저장하면 기존 FAQ 를 덮어쓸 수 있다.
      setFaqs([]);
      setFaqError(true);
    } finally {
      setFaqLoading(false);
    }
  }, []);

  // 마운트 시 이력·FAQ 만 로드한다. 발송은 절대 자동 실행하지 않는다.
  useEffect(() => {
    if (isLoading) return;
    void loadNoticeHistory();
  }, [isLoading, loadNoticeHistory]);

  useEffect(() => {
    void loadFaqs();
  }, [loadFaqs]);

  /* ── 수신자 후보 파생 ───────────────────────────────────────────── */

  // 조직 필터 후보(법인>본부>부>팀) — 전체 직원의 org 필드에서 뽑는다.
  const orgItems = useMemo<OrgFields[]>(
    () => records.map((r) => r.employee),
    [records],
  );

  /**
   * 선택된 범위(평가자/피평가자)별 수신자 후보.
   *  - 평가자: record.evaluation?.evaluator_id distinct(배정된 평가자만 — 커버리지 범위 명시).
   *  - 피평가자: employee_id 직접 사용.
   * 두 경우 모두 id 가 빈/널이면 제외한다(서버 placeholder 직원행 자동생성 방지 — 보정1).
   */
  const recipients = useMemo<RecipientRow[]>(() => {
    const byId = new Map<string, RecipientRow>();
    for (const record of records) {
      // 조직 필터: 평가자/피평가자 공통으로 피평가자(=record.employee)의 소속 기준.
      if (!matchesOrgNodes(record.employee, orgFilter)) continue;

      if (audience === 'evaluatees') {
        const id = record.employee.employee_id?.trim();
        if (!id) continue; // 빈/널 id 제외 — 서버 더미행 방지.
        if (!record.employee.available_roles?.includes('evaluatee')) continue;
        if (!byId.has(id)) {
          byId.set(id, {
            id,
            name: record.employee.name,
            org: record.employee,
            lastNoticeAt: recentNoticeAt.get(id) ?? null,
          });
        }
      } else {
        // 평가자: 배정 정보에서만 파생(빈/널 제외). 담당 0 평가자는 소스 특성상 누락될 수 있음.
        const evaluatorId = (
          record.evaluation?.evaluator_id ??
          record.employee.evaluator_id ??
          ''
        ).trim();
        if (!evaluatorId) continue;
        const evaluatorName =
          record.evaluation?.evaluator_name ?? `평가자 ${evaluatorId}`;
        if (!byId.has(evaluatorId)) {
          byId.set(evaluatorId, {
            id: evaluatorId,
            name: evaluatorName,
            org: record.employee,
            lastNoticeAt: recentNoticeAt.get(evaluatorId) ?? null,
          });
        }
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [records, audience, orgFilter, recentNoticeAt]);

  const selectableIds = useMemo(() => recipients.map((r) => r.id), [recipients]);

  // 이름·부서 검색으로 후보를 좁혀 선택한다(긴 목록 스크롤 대체). 선택은 검색을 바꿔도 유지된다.
  const filteredRecipients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter(
      (r) => r.name.toLowerCase().includes(q) || orgSearchText(r.org).toLowerCase().includes(q),
    );
  }, [recipients, search]);
  const filteredIds = useMemo(() => filteredRecipients.map((r) => r.id), [filteredRecipients]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const toggleAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) for (const id of filteredIds) next.delete(id);
      else for (const id of filteredIds) next.add(id);
      return next;
    });
  };

  // 범위/필터가 바뀌면 더 이상 후보에 없는 선택은 정리한다.
  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(selectableIds);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [selectableIds]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = useMemo(
    () => recipients.filter((r) => selectedIds.has(r.id)),
    [recipients, selectedIds],
  );

  // 24h 이내 이미 발송된 선택 대상(중복가드 대상) — 발송에서 제외된다.
  const alreadySentRows = useMemo(
    () => selectedRows.filter((r) => r.lastNoticeAt !== null),
    [selectedRows],
  );
  const sendableRows = useMemo(
    () => selectedRows.filter((r) => r.lastNoticeAt === null),
    [selectedRows],
  );

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const contentReady = trimmedTitle.length > 0 && trimmedBody.length > 0;

  const canOpenConfirm =
    contentReady &&
    selectedRows.length > 0 &&
    !sending &&
    !isLoading &&
    !historyLoading;

  const handleConfirmSend = async () => {
    if (!user) return;
    setConfirmOpen(false);
    setSending(true);
    try {
      // 가드 직전 이력을 한 번 더 새로고침(전역 1회) — 다른 세션 발송분 반영.
      await loadNoticeHistory();

      if (!contentReady) {
        toast({
          title: '공지 내용을 입력하세요',
          description: '제목과 본문을 모두 입력해야 발송할 수 있습니다.',
          variant: 'destructive',
        });
        return;
      }

      // recipientId Set 으로 유일화 + 24h 이내 발송분 제외 + 빈 id 최종 방어(보정1).
      const seen = new Set<string>();
      const targets = sendableRows.filter((r) => {
        const id = r.id?.trim();
        if (!id) return false;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });

      if (targets.length === 0) {
        toast({
          title: '발송할 대상이 없습니다',
          description: '선택한 수신자는 모두 24시간 이내에 이미 발송되었습니다.',
        });
        return;
      }

      const periodPrefix = selectedPeriod ? `[${selectedPeriod.name}] ` : '';
      const payloads: DispatchPayload[] = targets.map((row) => ({
        notification_type: 'notice',
        title: trimmedTitle,
        message: `${periodPrefix}${trimmedBody}`,
        priority: 'medium',
        sender_id: SENDER_ID,
        sender_name: SENDER_NAME,
        recipient_id: row.id,
        related_evaluation_id: null as string | null,
        related_task_id: null as string | null,
        is_read: false,
      }));

      // 이메일 채널은 보류(백엔드 미구현) — 동작하는 인앱만 발송한다.
      const channels: NotificationChannel[] = ['inApp'];
      const results = await dispatchNotifications(payloads, channels);

      const sent = results.filter((r) => r.outcome === 'sent');
      const failed = results.filter((r) => r.outcome === 'failed');

      const nameOf = (recipientId: string) =>
        targets.find((t) => t.id === recipientId)?.name ?? recipientId;

      const failDetail =
        failed.length > 0
          ? ` 실패: ${failed.map((f) => `${nameOf(f.recipientId)}(${f.reason ?? '오류'})`).join(', ')}`
          : '';

      toast({
        title: '공지 발송 결과',
        description: `성공 ${sent.length} · 실패 ${failed.length}.${failDetail}`,
        variant: failed.length > 0 ? 'destructive' : undefined,
      });

      // 발송 후 선택 해제 + 이력 재로드(최근 발송시각 갱신).
      setSelectedIds(new Set());
      await loadNoticeHistory();
    } catch (err) {
      toast({
        title: '발송 실패',
        description: err instanceof Error ? err.message : '공지를 발송하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  /* ── FAQ CRUD ───────────────────────────────────────────────────── */

  const addFaq = () => {
    setFaqs((prev) => [...prev, { id: newId(), question: '', answer: '' }]);
  };

  const updateFaq = (id: string, key: 'question' | 'answer', value: string) => {
    setFaqs((prev) => prev.map((f) => (f.id === id ? { ...f, [key]: value } : f)));
  };

  const removeFaq = (id: string) => {
    setFaqs((prev) => prev.filter((f) => f.id !== id));
  };

  const moveFaq = (id: string, dir: -1 | 1) => {
    setFaqs((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleSaveFaqs = async () => {
    setFaqSaving(true);
    try {
      // trim 후 question/answer 둘 다 빈 항목은 자동 제외(보정6).
      const cleaned: FaqItem[] = faqs
        .map((f) => ({
          id: f.id,
          question: f.question.trim(),
          answer: f.answer.trim(),
        }))
        .filter((f) => f.question.length > 0 && f.answer.length > 0);

      // 동시편집 보호(낙관적 잠금·스키마 변경 0): 로드 이후 다른 사용자가 저장했는지 확인한다.
      // 서버 최신본이 내가 불러온 스냅샷과 다르면 저장을 막아 남의 변경이 통째로 덮여 사라지는 것을 방지.
      const latest = await settingService.getUserSetting(FAQ_SETTING_USER, FAQ_SETTING_TYPE);
      const latestData = latest?.setting_data as Partial<FaqCatalog> | null | undefined;
      const latestNorm = normalizeFaqCatalog(Array.isArray(latestData?.faqs) ? latestData.faqs : []);
      if (latestNorm !== baselineFaqRef.current) {
        toast({
          title: '다른 사용자가 FAQ를 변경했습니다',
          description: '최신 내용을 불러온 뒤 다시 편집해 주세요. 이번 편집분은 저장되지 않았습니다.',
          variant: 'destructive',
        });
        return;
      }

      await settingService.saveSetting(FAQ_SETTING_USER, FAQ_SETTING_TYPE, {
        faqs: cleaned,
      } satisfies FaqCatalog);

      baselineFaqRef.current = normalizeFaqCatalog(cleaned);
      setFaqs(cleaned);
      toast({
        title: 'FAQ 저장 완료',
        description: `FAQ ${cleaned.length}건을 저장했습니다.`,
      });
    } catch (err) {
      toast({
        title: 'FAQ 저장 실패',
        description: err instanceof Error ? err.message : 'FAQ를 저장하지 못했습니다.',
        variant: 'destructive',
      });
    } finally {
      setFaqSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="공지·FAQ"
        subtitle="평가 관계자에게 일괄 인앱 공지를 발송하고, 공통 FAQ를 관리합니다. 공지 발송은 범위 선택·확인 후에만 진행됩니다."
        actions={
          <button
            className="sd-btn sd-btn-outline sd-btn-sm"
            onClick={() => {
              void loadNoticeHistory();
              void loadFaqs();
            }}
            disabled={isLoading || historyLoading || faqLoading || sending || faqSaving}
          >
            {historyLoading || faqLoading ? '불러오는 중…' : '새로고침'}
          </button>
        }
      />

      {/* ── 탭 바 — 세그먼트 컨트롤로 통일(HR 페이지 공통 탭 패턴) ── */}
      <div style={{ padding: '12px 32px 0' }}>
        <div className="sd-seg">
          {([
            { key: 'notice', label: '공지 발송' },
            { key: 'faq', label: '공통 FAQ' },
          ] as const).map(({ key, label }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`sd-seg-item${active ? ' is-active' : ''}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: '20px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* ── 일괄 공지 발송 ─────────────────────────────────────── */}
        {tab === 'notice' && (
        <section>
          <h2 style={sectionTitle}>일괄 공지 발송</h2>

          {/* 수신자 범위 + 조직 필터 */}
          <div className="sd-card" style={{ padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(Object.keys(AUDIENCE_LABEL) as AudienceKey[]).map((key) => {
                const active = audience === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={active ? 'sd-btn sd-btn-primary sd-btn-sm' : 'sd-btn sd-btn-outline sd-btn-sm'}
                    onClick={() => setAudience(key)}
                    disabled={sending}
                  >
                    {AUDIENCE_LABEL[key]}
                  </button>
                );
              })}
            </div>
            <OrgChecklist items={orgItems} value={orgFilter} onChange={setOrgFilter} />
            <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
              {audience === 'evaluators'
                ? '현재 평가가 배정된 평가자만 집계됩니다(담당 피평가자가 없는 평가자는 포함되지 않습니다).'
                : '평가 대상 피평가자를 집계합니다.'}
            </div>
          </div>

          {/* 공지 내용 입력 */}
          <div className="sd-card" style={{ padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={fieldLabel}>제목</span>
              <input
                className="sd-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="공지 제목"
                maxLength={120}
                disabled={sending}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={fieldLabel}>본문</span>
              <textarea
                className="sd-input"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="공지 본문 (인앱 알림 메시지로 발송됩니다)"
                rows={4}
                maxLength={1000}
                disabled={sending}
                style={{ resize: 'vertical', minHeight: 96 }}
              />
            </label>
          </div>

          {/* 요약 + 발송 버튼 */}
          <div
            className="sd-card"
            style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, marginBottom: 16 }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-body)' }}>
                {AUDIENCE_LABEL[audience]}{' '}
                <strong style={{ color: 'var(--fg)' }}>{recipients.length}</strong>명 · 선택{' '}
                <strong style={{ color: 'var(--ok-orange)' }}>{selectedRows.length}</strong>명
              </div>
              <button
                className="sd-btn sd-btn-primary sd-btn-sm"
                disabled={!canOpenConfirm}
                onClick={() => setConfirmOpen(true)}
              >
                {sending ? '발송 중…' : `선택한 ${selectedRows.length}명에게 공지 발송`}
              </button>
            </div>
            {selectedRows.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  alignItems: 'center',
                  paddingTop: 10,
                  borderTop: '1px solid var(--border)',
                }}
              >
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', marginRight: 2 }}>선택된 대상자</span>
                {selectedRows.map((r) => (
                  <span
                    key={r.id}
                    className="sd-chip sd-chip-orange"
                    style={{ paddingRight: 4 }}
                  >
                    {r.name}
                    <button
                      type="button"
                      onClick={() => toggle(r.id)}
                      disabled={sending}
                      aria-label={`${r.name} 제외`}
                      style={{
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        color: 'inherit',
                        lineHeight: 1,
                        padding: '0 2px',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      <X size={12} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 수신자 목록 */}
          {isLoading ? (
            <LoadingState message="불러오는 중…" />
          ) : error ? (
            <ErrorState message={error} />
          ) : recipients.length === 0 ? (
            <EmptyState message="선택한 범위에 해당하는 수신자가 없습니다." />
          ) : (
          <div className="sd-card" style={{ padding: 0, overflow: 'hidden' }}>
            {recipients.length > 0 && (
              <div
                style={{
                  padding: 12,
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <input
                  className="sd-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="이름 또는 부서로 검색해 대상자 추가"
                  style={{ flex: 1, minWidth: 220 }}
                  disabled={sending}
                />
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-muted)', whiteSpace: 'nowrap' }}>
                  검색 {filteredRecipients.length}명 · 선택 {selectedRows.length}명
                </span>
                {selectedRows.length > 0 && (
                  <button
                    type="button"
                    className="sd-btn sd-btn-outline sd-btn-sm"
                    onClick={() => setSelectedIds(new Set())}
                    disabled={sending}
                  >
                    선택 비우기
                  </button>
                )}
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-body)' }}>
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      <th style={th}>
                        <input
                          type="checkbox"
                          aria-label="검색 결과 전체 선택"
                          checked={allFilteredSelected}
                          onChange={toggleAllFiltered}
                          disabled={sending}
                        />
                      </th>
                      <th style={th}>이름</th>
                      <th style={th}>부서</th>
                      <th style={th}>식별자</th>
                      <th style={th}>최근 발송(24h)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecipients.length === 0 && (
                      <tr>
                        <td style={{ ...td, color: 'var(--fg-muted)' }} colSpan={5}>
                          검색 결과가 없습니다.
                        </td>
                      </tr>
                    )}
                    {filteredRecipients.map((row) => {
                      const checked = selectedIds.has(row.id);
                      const recentlySent = row.lastNoticeAt !== null;
                      return (
                        <tr key={row.id} className="row-hover">
                          <td style={td}>
                            <input
                              type="checkbox"
                              aria-label={`${row.name} 선택`}
                              checked={checked}
                              onChange={() => toggle(row.id)}
                              disabled={sending}
                            />
                          </td>
                          <td style={td}>
                            <strong>{row.name}</strong>
                          </td>
                          <td style={{ ...td, color: 'var(--fg-muted)' }}>{orgDeptLabel(row.org)}</td>
                          <td style={{ ...td, color: 'var(--fg-muted)' }}>{row.id}</td>
                          <td style={td} className="tnum">
                            {recentlySent ? (
                              <span style={{ color: 'var(--ok-orange)', fontWeight: 600 }}>
                                {fmtDateTime(row.lastNoticeAt)} (제외)
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
          </div>
          )}
        </section>
        )}

        {/* ── 공통 FAQ 관리 ──────────────────────────────────────── */}
        {tab === 'faq' && (
        <section>
          <h2 style={sectionTitle}>공통 FAQ 관리</h2>
          <div
            className="sd-card"
            style={{
              padding: 16,
              marginBottom: 16,
              background: 'var(--info-bg)',
              borderColor: 'var(--info)',
              color: 'var(--info)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
            }}
          >
            FAQ는 전사 공통 카탈로그입니다. 편집을 시작한 뒤 다른 HR이 먼저 저장했다면, 저장 시 그
            변경을 덮어쓰지 않도록 자동으로 막고 알려드립니다 — 최신 내용을 다시 불러와 편집하세요.
          </div>

          <div className="sd-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {faqLoading ? (
              <LoadingState message="불러오는 중…" />
            ) : faqError ? (
              <ErrorState message="FAQ를 불러오지 못했습니다. 저장 전에 반드시 다시 불러와 주세요(빈 목록으로 저장하면 기존 FAQ를 덮어씁니다)." onRetry={() => void loadFaqs()} />
            ) : faqs.length === 0 ? (
              <EmptyState message="등록된 FAQ가 없습니다. 아래 “항목 추가”로 시작하세요." />
            ) : (
              faqs.map((faq, idx) => (
                <div
                  key={faq.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)', fontWeight: 700 }}>
                      #{idx + 1}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="sd-btn sd-btn-outline sd-btn-sm"
                        onClick={() => moveFaq(faq.id, -1)}
                        disabled={idx === 0 || faqSaving}
                        aria-label="위로 이동"
                      >
                        <ChevronUp size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="sd-btn sd-btn-outline sd-btn-sm"
                        onClick={() => moveFaq(faq.id, 1)}
                        disabled={idx === faqs.length - 1 || faqSaving}
                        aria-label="아래로 이동"
                      >
                        <ChevronDown size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="sd-btn sd-btn-outline sd-btn-sm"
                        onClick={() => removeFaq(faq.id)}
                        disabled={faqSaving}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={fieldLabel}>질문</span>
                    <input
                      className="sd-input"
                      value={faq.question}
                      onChange={(e) => updateFaq(faq.id, 'question', e.target.value)}
                      placeholder="자주 묻는 질문"
                      maxLength={200}
                      disabled={faqSaving}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={fieldLabel}>답변</span>
                    <textarea
                      className="sd-input"
                      value={faq.answer}
                      onChange={(e) => updateFaq(faq.id, 'answer', e.target.value)}
                      placeholder="답변 내용"
                      rows={3}
                      maxLength={1000}
                      disabled={faqSaving}
                      style={{ resize: 'vertical', minHeight: 72 }}
                    />
                  </label>
                </div>
              ))
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="sd-btn sd-btn-outline sd-btn-sm"
                onClick={addFaq}
                disabled={faqLoading || faqSaving}
              >
                항목 추가
              </button>
              <button
                type="button"
                className="sd-btn sd-btn-primary sd-btn-sm"
                onClick={() => void handleSaveFaqs()}
                disabled={faqLoading || faqSaving}
              >
                {faqSaving ? '저장 중…' : 'FAQ 저장'}
              </button>
            </div>
            <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-xs)' }}>
              질문·답변이 모두 채워진 항목만 저장됩니다(빈 항목은 자동 제외).
            </div>
          </div>
        </section>
        )}
      </div>

      {/* ── 발송 확인 다이얼로그 ─────────────────────────────────── */}
      <AlertDialog open={confirmOpen} onOpenChange={(open) => !sending && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>공지 발송 확인</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span>
                  {AUDIENCE_LABEL[audience]} 중 선택한 <strong>{selectedRows.length}</strong>명 가운데{' '}
                  <strong>{sendableRows.length}</strong>명에게 인앱 공지를 발송합니다 (이메일: 미설정).
                </span>
                <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-sm)' }}>
                  제목: {trimmedTitle || '(없음)'}
                </span>
                {alreadySentRows.length > 0 && (
                  <span style={{ color: 'var(--ok-orange)' }}>
                    {alreadySentRows[0].name}
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

const sectionTitle: CSSProperties = {
  fontSize: 'var(--fs-lg)',
  fontWeight: 700,
  color: 'var(--fg)',
  marginBottom: 12,
};

const fieldLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  color: 'var(--fg-muted)',
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

export default HrNoticesFaqPage;
