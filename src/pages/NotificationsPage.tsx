import { useMemo, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import NotificationItem from '@/components/Notification/NotificationItem';
import { useNotifications } from '@/contexts/NotificationContextDB';

type FilterId = 'all' | 'unread';

const NotificationsPage = () => {
  const { notifications, markAsRead, markAllAsRead, deleteAllNotifications } = useNotifications();
  const [filter, setFilter] = useState<FilterId>('all');

  const visible = useMemo(
    () => (filter === 'unread' ? notifications.filter((n) => !n.isRead) : notifications),
    [notifications, filter],
  );

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const recipientId = notifications[0]?.recipientId ?? '';

  const filters: Array<{ id: FilterId; label: string; count: number }> = [
    { id: 'all', label: '전체', count: notifications.length },
    { id: 'unread', label: '읽지 않음', count: unreadCount },
  ];

  const handleClearAll = () => {
    if (!recipientId) return;
    if (window.confirm('모든 알림을 삭제하시겠습니까?')) {
      void deleteAllNotifications(recipientId);
    }
  };

  return (
    <>
      <PageHeader title="알림" subtitle={`총 ${notifications.length}건 · 읽지 않음 ${unreadCount}건`} />

      <div style={{ padding: '24px 32px 32px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            marginBottom: 18,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  padding: '5px 14px',
                  borderRadius: 8,
                  border: '1px solid',
                  borderColor: filter === f.id ? 'var(--ok-orange)' : 'var(--border)',
                  background: filter === f.id ? 'var(--ok-orange)' : 'transparent',
                  color: filter === f.id ? '#fff' : 'var(--fg)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {f.label} {f.count > 0 && <span style={{ marginLeft: 4 }}>{f.count}</span>}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="sd-btn sd-btn-outline sd-btn-sm"
              >
                모두 읽음
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={handleClearAll}
                className="sd-btn sd-btn-outline sd-btn-sm"
                style={{ color: 'var(--danger)' }}
              >
                전체 삭제
              </button>
            )}
          </div>
        </div>

        <div
          className="sd-card"
          style={{
            padding: 0,
            overflow: 'hidden',
          }}
        >
          {visible.length === 0 ? (
            <div
              style={{
                padding: '48px 18px',
                textAlign: 'center',
                color: 'var(--fg-muted)',
                fontSize: 13,
              }}
            >
              {filter === 'unread' ? '읽지 않은 알림이 없습니다.' : '알림이 없습니다.'}
            </div>
          ) : (
            visible.map((n) => (
              <NotificationItem key={n.id} notification={n} onMarkAsRead={markAsRead} />
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default NotificationsPage;
