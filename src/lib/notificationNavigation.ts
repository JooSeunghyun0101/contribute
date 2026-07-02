import type { UserRole } from '@/types';
import type { Notification, NotificationType } from '@/types/notification';

// 알림 클릭 시 이동할 화면 매핑 — 역할별 "정적" 목적지.
// 개별 평가/과업 딥링크(relatedEvaluationId 활용)는 후속 과업이므로 여기서는 역할 대표 화면까지만 보낸다.
// 목적지가 애매한 타입(evaluator_unassigned: 대상 제외라 보드에 볼 것이 없음,
// 일반 hr_message: 수신 맥락이 다양함)은 매핑하지 않는다 → 클릭 시 현행처럼 읽음 처리만 된다.
// 역할 분류 기준은 src/lib/notificationRoles.ts 와 같은 비즈니스 의미를 따른다.

const DESTINATIONS: Partial<Record<NotificationType, Partial<Record<UserRole, string>>>> = {
  // 피평가자 — 점수·과업·평가 진행 상태는 "내 과업", 코멘트·완료 결과는 "피드백 이력"
  score_changed: { evaluatee: '/my/tasks' },
  evaluation_started: { evaluatee: '/my/tasks' },
  evaluation_reopened: { evaluatee: '/my/tasks' },
  feedback_added: { evaluatee: '/my/feedback' },
  evaluation_completed: { evaluatee: '/my/feedback' },
  // task_updated 는 평가자가 과업을 수정해 "피평가자"가 받는 알림(발송처: useEvaluationDataDB 단일).
  // evaluator 매핑을 두면 겸직자가 평가자 탭에서 클릭 시 무관한 보드로 이동하므로 evaluatee 만 둔다.
  task_updated: { evaluatee: '/my/tasks' },

  // 평가자 — 평가 보드(/team)로
  evaluation_submitted: { evaluator: '/team' },
  task_content_changed: { evaluator: '/team' },
  task_summary: { evaluator: '/team' },
  evaluation_updated: { evaluator: '/team' },
  user_assigned: { evaluator: '/team' },
  evaluation_return_requested: { evaluator: '/team' },
  reminder: { evaluator: '/team' },
  // 평가자 변경은 새로 배정된 "평가자"에게도 발송된다(server.js) — 평가자면 보드로, 피평가자에게는 정보성이라 미매핑
  evaluator_changed: { evaluator: '/team' },

  // 평가자 변경요청 — 접수는 HR 처리 화면, 결과는 요청자 역할의 변경요청 화면
  change_request: { hr: '/hr/change-requests' },
  change_request_result: { evaluatee: '/my/evaluator-request', evaluator: '/team/evaluator-request' },

  // HR — 프로필 임포트 결과는 사용자 관리에서 확인
  profile_imported: { hr: '/hr/users' },
};

// hr_message 중 비밀번호 초기화 요청만 예외적으로 매핑한다.
// 판별 근거: server.js /api/auth/password-reset-request 가 title '비밀번호 초기화 요청'으로 발송.
// 목적지 탭 'account' = HrSettingsPage 의 비밀번호(초기화 승인/반려) 탭.
const PASSWORD_RESET_TITLE = '비밀번호 초기화';

/**
 * 알림 → 이동 경로. 매핑이 없으면 null(이동 없음).
 * @param role 현재 사용자 역할 — 겸직자는 현재 보고 있는 역할 탭의 역할을 넘긴다.
 */
export const getNotificationDestination = (
  notification: Pick<Notification, 'type' | 'title'>,
  role: UserRole | null | undefined,
): string | null => {
  if (!role) return null;
  if (notification.type === 'hr_message') {
    return role === 'hr' && notification.title.includes(PASSWORD_RESET_TITLE)
      ? '/hr/settings?tab=account'
      : null;
  }
  return DESTINATIONS[notification.type]?.[role] ?? null;
};
