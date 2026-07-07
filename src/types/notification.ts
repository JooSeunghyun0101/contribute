
export type NotificationType =
  | 'score_changed'
  | 'task_content_changed'
  | 'feedback_added'
  | 'task_updated'
  | 'evaluation_updated'
  | 'evaluation_started'
  | 'evaluation_submitted'
  | 'evaluation_completed'
  | 'hr_message'
  | 'user_assigned'
  | 'task_summary'
  | 'evaluator_changed'
  | 'evaluator_unassigned'
  | 'profile_imported'
  | 'evaluation_return_requested'
  | 'evaluation_reopened'
  | 'change_request'
  | 'change_request_result'
  | 'reminder'
  // AI 검수(백그라운드)에서 확인 필요 피드백이 발견됐을 때 "평가자 본인"에게 — 토스트는
  // 잠깐 떴다 사라지므로, 놓쳐도 남는 영속 채널(벨)로도 보낸다.
  | 'ai_review_flagged'
  // 평가자가 보드에서 미제출 팀원에게 보내는 성과보고 제출 리마인드(P3-8, 수신=피평가자).
  | 'submit_reminder';

export type NotificationPriority = 'low' | 'medium' | 'high';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: NotificationPriority;
  senderId: string;
  senderName: string;
  recipientId: string;
  relatedEvaluationId?: string;
  relatedTaskId?: string;
  isRead: boolean;
  createdAt: string;
  readAt?: string;
  lastModified?: string;
}

export interface NotificationContext {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => void;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  deleteNotification: (notificationId: string) => void;
  deleteAllNotifications: (userId: string) => void;
  cleanupOldNotifications: () => void;
  getNotificationsForUser: (userId: string) => Notification[];
}
