import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '@/components/Layout/PageHeader';
import NotificationItem from '@/components/Notification/NotificationItem';
import { FilterChip } from '@/components/brand/FilterChip';
import { EmptyState } from '@/components/ui/state-views';
import { useNotifications } from '@/contexts/NotificationContextDB';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { FaqSection } from '@/components/FaqSection';
import type { UserRole } from '@/types';
import { ROLE_ORDER, ROLE_LABEL, rolesOf } from '@/lib/notificationRoles';

type FilterId = 'all' | 'unread';

const NotificationsPage = () => {
  const { notifications, markAsRead, markAllAsRead, deleteAllNotifications, deleteNotification } =
    useNotifications();
  const { user, switchRole } = useAuth();
  const navigate = useNavigate();
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

  // 딥링크 매핑에 쓸 역할 — 역할 탭이 있으면 현재 탭 역할, 아니면 로그인 역할.
  const tabRole: UserRole | null = showRoleTabs ? roleFilter : (user?.role ?? null);

  // 알림 클릭 이동. 겸직자가 다른 역할 탭의 알림을 클릭하면 그 역할로 전환 후 이동한다
  // (TopBar 역할 전환과 동일 동작 — 전환 없이 이동하면 ProtectedRoute 가 홈으로 되돌린다).
  const handleItemNavigate = (path: string) => {
    if (user && tabRole && tabRole !== user.role && user.availableRoles.includes(tabRole)) {
      // switchRole 은 동기적 상태 갱신 — navigate 와 같은 배치로 렌더되어 권한 체크가 새 역할로 평가된다.
      void switchRole(tabRole);
    }
    navigate(path);
  };

  const filters: Array<{ id: FilterId; label: string; count: number }> = [
    { id: 'all', label: '전체', count: roleScoped.length },
    { id: 'unread', label: '읽지 않음', count: unreadCount },
  ];

  const handleClearAll = async () => {
    if (!recipientId) return;
    // P3-3: 겸직자는 현재 역할 탭의 알림만 삭제 — '전체 삭제'가 다른 역할 탭의 알림까지
    // 지워버리는 사고 방지("모두 읽음"의 역할 분리와 동일 기준).
    if (showRoleTabs && roleFilter) {
      // 리뷰 확정 수정: hr_message 등 여러 역할 공용 타입은 단일 알림이라 삭제 시 다른 탭에서도
      // 함께 사라진다 — '다른 탭 알림은 남는다'는 단정 문구가 거짓이 되지 않게 실제 동작을 안내.
      const ok = await confirm({
        title: `${ROLE_LABEL[roleFilter]} 탭의 알림 ${roleScoped.length}건을 삭제하시겠습니까?`,
        description:
          '이 탭에 표시된 알림만 삭제합니다. 단, 여러 역할에 공통으로 표시되는 알림(공지 등)은 다른 역할 탭에서도 함께 삭제됩니다.',
        variant: 'danger',
        confirmText: '삭제',
      });
      if (!ok) return;
      for (const n of roleScoped) void deleteNotification(n.id);
      return;
    }
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
              <button onClick={handleClearAll} className="sd-btn sd-btn-danger sd-btn-sm">
                전체 삭제
              </button>
            )}
          </>
        }
        filters={
          <>
            {/* 역할별 분리 탭 — 보유 역할이 2개 이상일 때만 */}
            {showRoleTabs && (
              <div className="sd-seg">
                {roleTabs.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRoleFilter(r)}
                    className={`sd-seg-item${roleFilter === r ? ' is-active' : ''}`}
                  >
                    {ROLE_LABEL[r]}
                    {(roleUnread[r] ?? 0) > 0 && (
                      <span className="tnum" style={{ marginLeft: 6 }}>{roleUnread[r]}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 6 }}>
              {filters.map((f) => (
                <FilterChip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}{' '}
                  {f.count > 0 && <span className="tnum" style={{ marginLeft: 4 }}>{f.count}</span>}
                </FilterChip>
              ))}
            </div>
          </>
        }
      />

      <div style={{ padding: '24px 32px 32px' }}>
        {visible.length === 0 ? (
          <EmptyState
            message={filter === 'unread' ? '읽지 않은 알림이 없습니다.' : '알림이 없습니다.'}
          />
        ) : (
          <div
            className="sd-card"
            style={{
              padding: 0,
              overflow: 'hidden',
            }}
          >
            {visible.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onMarkAsRead={markAsRead}
                currentRole={tabRole}
                onNavigate={handleItemNavigate}
              />
            ))}
          </div>
        )}

        {/* HR이 등록한 FAQ를 전 직원에게 노출 (FAQ 없으면 자동 숨김) */}
        <FaqSection />
      </div>
    </>
  );
};

export default NotificationsPage;
