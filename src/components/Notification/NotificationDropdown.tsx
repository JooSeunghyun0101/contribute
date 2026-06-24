import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Notification } from '@/types/notification';
import { useNotifications } from '@/contexts/NotificationContextDB';
import NotificationItem from './NotificationItem';

interface NotificationDropdownProps {
  notifications: Notification[];
  onClose: () => void;
}

const NotificationDropdown: React.FC<NotificationDropdownProps> = ({ notifications, onClose }) => {
  const { markAllAsRead, markAsRead } = useNotifications();
  const navigate = useNavigate();
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleViewAll = () => {
    onClose();
    navigate('/notifications');
  };

  return (
    <div
      style={{
        position: 'absolute',
        right: 0,
        top: '100%',
        marginTop: 8,
        width: 380,
        maxWidth: 'calc(100vw - 2rem)',
        zIndex: 60,
        background: 'var(--bg-card, #fff)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 18px 10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 'var(--fs-h4)', fontWeight: 800, color: 'var(--fg)' }}>알림</span>
          {unreadCount > 0 && (
            <span
              style={{
                fontSize: 'var(--fs-xs)',
                fontWeight: 700,
                color: 'var(--ok-orange)',
                background: 'var(--ok-orange-50)',
                padding: '2px 8px',
                borderRadius: 10,
              }}
            >
              신규 {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllAsRead}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            모두 읽음
          </button>
        )}
      </div>

      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
        {notifications.length === 0 ? (
          <div
            style={{
              padding: '40px 18px',
              textAlign: 'center',
              color: 'var(--fg-muted)',
              fontSize: 'var(--fs-body)',
            }}
          >
            새로운 알림이 없습니다.
          </div>
        ) : (
          notifications.map((n) => (
            <NotificationItem key={n.id} notification={n} onMarkAsRead={markAsRead} />
          ))
        )}
      </div>

      <button
        type="button"
        onClick={handleViewAll}
        style={{
          width: '100%',
          padding: '12px 18px',
          background: 'transparent',
          border: 'none',
          borderTop: '1px solid var(--border)',
          fontSize: 'var(--fs-sm)',
          fontWeight: 700,
          color: 'var(--ok-orange)',
          cursor: 'pointer',
          textAlign: 'center',
        }}
      >
        전체 알림 보기 →
      </button>
    </div>
  );
};

export default NotificationDropdown;
