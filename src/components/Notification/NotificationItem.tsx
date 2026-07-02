import React from 'react';
import {
  CheckCircle2,
  MessageSquare,
  Target,
  FileText,
  Calendar,
  UserPlus,
  UserMinus,
  Bell,
  Undo2,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import { Notification, NotificationType } from '@/types/notification';
import { getNotificationDestination } from '@/lib/notificationNavigation';
import type { UserRole } from '@/types';

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  /** 딥링크 매핑에 쓸 역할 — 겸직자는 현재 보고 있는 역할 탭의 역할. 없으면 이동 없음. */
  currentRole?: UserRole | null;
  /** 매핑된 목적지가 있을 때 호출(팝오버 닫기·역할 전환 등은 호출측 책임). 없으면 이동 없음. */
  onNavigate?: (path: string) => void;
}

const ICON_MAP: Record<NotificationType, LucideIcon> = {
  feedback_added: MessageSquare,
  task_summary: MessageSquare,
  evaluation_completed: CheckCircle2,
  evaluation_started: CheckCircle2,
  evaluation_submitted: CheckCircle2,
  score_changed: Target,
  task_content_changed: FileText,
  task_updated: FileText,
  evaluation_updated: Calendar,
  hr_message: Bell,
  user_assigned: UserPlus,
  evaluator_changed: UserPlus,
  evaluator_unassigned: UserMinus,
  profile_imported: FileText,
  evaluation_return_requested: AlertCircle,
  evaluation_reopened: Undo2,
  change_request: UserPlus,
  change_request_result: CheckCircle2,
  reminder: Bell,
};

const formatRelativeTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return '방금 전';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) {
    const h = date.getHours();
    const m = date.getMinutes();
    return `오늘 ${h < 12 ? '오전' : '오후'} ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
  }
  if (diffSec < 86400 * 2) return '어제';
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}일 전`;
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(date);
};

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onMarkAsRead,
  currentRole,
  onNavigate,
}) => {
  const Icon = ICON_MAP[notification.type] ?? Bell;
  const isUnread = !notification.isRead;
  // 타입·역할별 매핑이 있는 알림만 관련 화면으로 이동(없으면 현행처럼 읽음 처리만).
  const destination = onNavigate ? getNotificationDestination(notification, currentRole) : null;
  const clickable = isUnread || destination !== null;

  const handleClick = () => {
    if (isUnread) onMarkAsRead(notification.id);
    if (destination && onNavigate) onNavigate(destination);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors last:border-b-0${
        clickable ? ' hover:bg-[var(--bg-muted)]' : ''
      }`}
      style={{
        borderBottom: '1px solid var(--border)',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <div
        className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
        style={{
          background: isUnread ? 'var(--ok-orange)' : 'var(--bg-muted)',
          color: isUnread ? '#fff' : 'var(--fg-muted)',
          border: isUnread ? 'none' : '1px solid var(--border)',
        }}
      >
        <Icon size={14} />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <p
          className="text-sm leading-snug"
          style={{
            color: 'var(--fg)',
            fontWeight: isUnread ? 700 : 600,
          }}
        >
          {notification.title}
        </p>
        <p
          className="text-xs leading-relaxed"
          style={{
            color: 'var(--fg-muted)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {notification.message}
        </p>
        <p className="text-[11px]" style={{ color: 'var(--fg-subtle, var(--fg-muted))' }}>
          {notification.senderName} · {formatRelativeTime(notification.createdAt)}
        </p>
      </div>

      {isUnread && (
        <span
          aria-hidden="true"
          className="mt-2 inline-block size-2 flex-shrink-0 rounded-full"
          style={{ background: 'var(--ok-orange)' }}
        />
      )}
    </button>
  );
};

export default NotificationItem;
