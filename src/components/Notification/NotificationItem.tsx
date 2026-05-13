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
} from 'lucide-react';
import { Notification, NotificationType } from '@/types/notification';

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
}

const ICON_MAP: Record<NotificationType, React.ComponentType<{ size?: number }>> = {
  feedback_added: MessageSquare,
  task_summary: MessageSquare,
  evaluation_completed: CheckCircle2,
  evaluation_started: CheckCircle2,
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

const NotificationItem: React.FC<NotificationItemProps> = ({ notification, onMarkAsRead }) => {
  const Icon = ICON_MAP[notification.type] ?? Bell;
  const isUnread = !notification.isRead;

  return (
    <button
      type="button"
      onClick={() => isUnread && onMarkAsRead(notification.id)}
      style={{
        width: '100%',
        textAlign: 'left',
        background: isUnread ? 'var(--ok-orange-50)' : 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--border)',
        padding: '14px 18px',
        cursor: isUnread ? 'pointer' : 'default',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => {
        if (isUnread) e.currentTarget.style.background = 'var(--ok-orange-100, #FFE4D2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = isUnread ? 'var(--ok-orange-50)' : 'transparent';
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: isUnread ? 'var(--ok-orange)' : 'var(--bg-muted)',
          color: isUnread ? '#fff' : 'var(--fg-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <Icon size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--fg)', marginBottom: 4 }}>
          {notification.title}
        </div>
        <div
          style={{
            fontSize: 'var(--fs-sm)',
            lineHeight: 1.55,
            color: 'var(--fg-muted)',
            marginBottom: 6,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {notification.message}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)' }}>
          {notification.senderName} · {formatRelativeTime(notification.createdAt)}
        </div>
      </div>
    </button>
  );
};

export default NotificationItem;
