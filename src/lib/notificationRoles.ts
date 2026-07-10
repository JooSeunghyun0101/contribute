import type { UserRole } from '@/types';
import type { Notification, NotificationType } from '@/types/notification';

// 알림을 역할(피평가자/평가자/HR)별로 분리하기 위한 공통 매핑.
// 전체 알림 화면과 상단 알림 벨 팝업이 동일 기준을 쓰도록 한 곳에서 관리한다.

export const ROLE_ORDER: UserRole[] = ['evaluatee', 'evaluator', 'hr'];

export const ROLE_LABEL: Record<UserRole, string> = {
  evaluatee: '피평가자',
  evaluator: '평가자',
  hr: 'HR',
};

// 알림 타입별로 "어느 역할에서 받는 알림인지". 여러 역할에 걸치면 모두 나열.
// ── 비즈니스 의미 기준 best-effort. 분류가 어긋나면 이 표만 조정하면 된다.
export const NOTIFICATION_ROLES: Record<NotificationType, UserRole[]> = {
  // 피평가자 — 내가 '평가받는' 입장에서 받는 알림
  score_changed: ['evaluatee'],
  feedback_added: ['evaluatee'],
  evaluation_started: ['evaluatee'],
  evaluation_completed: ['evaluatee'],
  evaluation_reopened: ['evaluatee'],
  evaluator_changed: ['evaluatee'],
  // task_updated 는 평가자가 과업(점수·피드백)을 수정했을 때 "피평가자"가 받는 알림
  // (발송처: useEvaluationDataDB handleSave — recipientId=피평가자). 평가자 분류였던 것을 정정.
  task_updated: ['evaluatee'],
  // 평가자가 미제출 팀원에게 보내는 제출 리마인드(발송처: team/Home 보드, 수신=피평가자)
  submit_reminder: ['evaluatee'],
  // 평가자 — 내가 '평가하는' 입장에서 받는 알림
  task_content_changed: ['evaluator'],
  task_summary: ['evaluator'],
  evaluation_updated: ['evaluator'],
  user_assigned: ['evaluator'],
  evaluation_submitted: ['evaluator'],
  evaluation_return_requested: ['evaluator'],
  evaluator_unassigned: ['evaluator'],
  // AI 검수 경고 — 발송처: useEvaluationDataDB handleSave 백그라운드 검수(수신자=평가자 본인)
  ai_review_flagged: ['evaluator'],
  // HR
  profile_imported: ['hr'],
  change_request: ['hr'],
  // 역할 무관(공통) — 받는 쪽 역할이 다양함
  hr_message: ['evaluatee', 'evaluator', 'hr'],
  change_request_result: ['evaluatee', 'evaluator'],
  reminder: ['evaluator'],
};

/** 알림 타입이 속한 역할 목록(미정의 타입은 전체 역할로 간주). */
export const rolesOf = (type: NotificationType): UserRole[] => NOTIFICATION_ROLES[type] ?? ROLE_ORDER;

/** 특정 역할에 해당하는 알림만. */
export const filterByRole = <T extends Pick<Notification, 'type'>>(
  notifications: T[],
  role: UserRole,
): T[] => notifications.filter((n) => rolesOf(n.type).includes(role));
