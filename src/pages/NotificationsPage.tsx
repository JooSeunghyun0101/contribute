import { useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import NotificationItem from '@/components/Notification/NotificationItem';
import { useNotifications } from '@/contexts/NotificationContextDB';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { FaqSection } from '@/components/FaqSection';
import type { UserRole } from '@/types';
import { ROLE_ORDER, ROLE_LABEL, rolesOf } from '@/lib/notificationRoles';

type FilterId = 'all' | 'unread';

const NotificationsPage = () => {
  const { notifications, markAsRead, markAllAsRead, deleteAllNotifications } = useNotifications();
  const { user } = useAuth();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<FilterId>('all');

  // 사용자가 가진 역할만 탭으로. 2개 이상일 때만 역할 분리 노출.
  const roleTabs = useMemo(
    () => ROLE_ORDER.filter((r) => (user?.availableRoles ?? []).includes(r)),
    [user?.availableRoles],
  );
  const showRoleTabs = roleTabs.length > 1;

  const [roleFilter, setRoleFilter] = useState<UserRole | null>(null);
  // 기본 역할 = 현재 로그인 역할(없거나 탭에 없으면 첫 탭).
  useEffect(() => {
    if (!showRoleTabs) {
      setRoleFilter(null);
      return;
    }
    setRoleFilter((prev) => {
      if (prev && roleTabs.includes(prev)) return prev;
      if (user?.role && roleTabs.includes(user.role)) return user.role;
      return roleTabs[0];
    });
  }, [showRoleTabs, roleTabs, user?.role]);

  // 역할 탭별 미읽음 개수(배지용).
  const roleUnread = useMemo(() => {
    const counts: Partial<Record<UserRole, number>> = {};
    for (const r of roleTabs) counts[r] = 0;
    for (const n of notifications) {
      if (n.isRead) continue;
      for (const r of rolesOf(n.type)) {
        if (counts[r] !== undefined) counts[r] = (counts[r] ?? 0) + 1;
      }
    }
    return counts;
  }, [notifications, roleTabs]);

  // 현재 역할 탭으로 1차 필터.
  const roleScoped = useMemo(() => {
    if (!showRoleTabs || !roleFilter) return notifications;
    return notifications.filter((n) => rolesOf(n.type).includes(roleFilter));
  }, [notifications, showRoleTabs, roleFilter]);

  const visible = useMemo(
    () => (filter === 'unread' ? roleScoped.filter((n) => !n.isRead) : roleScoped),
    [roleScoped, filter],
  );

  const unreadCount = roleScoped.filter((n) => !n.isRead).length;
  const recipientId = notifications[0]?.recipientId ?? '';

  const filters: Array<{ id: FilterId; label: string; count: number }> = [
    { id: 'all', label: '전체', count: roleScoped.length },
    { id: 'unread', label: '읽지 않음', count: unreadCount },
  ];

  const handleClearAll = async () => {
    if (!recipientId) return;
    const ok = await confirm({
      title: '모든 알림을 삭제하시겠습니까?',
      variant: 'danger',
      confirmText: '모두 삭제',
    });
    if (ok) void deleteAllNotifications(recipientId);
  };

  // 역할 탭이 있으면 "모두 읽음"은 현재 탭에 보이는 알림만 처리(역할 분리와 일관).
  const handleMarkAllRead = () => {
    if (!showRoleTabs) {
      void markAllAsRead();
      return;
    }
    for (const n of roleScoped) {
      if (!n.isRead) void markAsRead(n.id);
    }
  };

  return (
    <>
      <PageHeader
        title="알림"
        subtitle={
          showRoleTabs && roleFilter
            ? `${ROLE_LABEL[roleFilter]} · 총 ${roleScoped.length}건 · 읽지 않음 ${unreadCount}건`
            : `총 ${roleScoped.length}건 · 읽지 않음 ${unreadCount}건`
        }
        actions={
          <>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="sd-btn sd-btn-outline sd-btn-sm">
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
          </>
        }
        filters={
          <>
            {/* 역할별 분리 탭 — 보유 역할이 2개 이상일 때만 */}
            {showRoleTabs && (
              <div
                style={{
                  display: 'inline-flex',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                {roleTabs.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRoleFilter(r)}
                    style={{
                      padding: '6px 16px',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: 'var(--fs-sm)',
                      background: roleFilter === r ? 'var(--ok-orange)' : 'transparent',
                      color: roleFilter === r ? '#fff' : 'var(--fg-muted)',
                    }}
                  >
                    {ROLE_LABEL[r]}
                    {(roleUnread[r] ?? 0) > 0 && (
                      <span style={{ marginLeft: 6 }}>{roleUnread[r]}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

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
                    fontSize: 'var(--fs-body)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {f.label} {f.count > 0 && <span style={{ marginLeft: 4 }}>{f.count}</span>}
                </button>
              ))}
            </div>
          </>
        }
      />

      <div style={{ padding: '24px 32px 32px' }}>
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
                fontSize: 'var(--fs-body)',
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

        {/* HR이 등록한 FAQ를 전 직원에게 노출 (FAQ 없으면 자동 숨김) */}
        <FaqSection />
      </div>
    </>
  );
};

export default NotificationsPage;
