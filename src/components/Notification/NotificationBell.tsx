import React, { useState } from 'react';
import { Bell, Inbox } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContextDB';
import { rolesOf } from '@/lib/notificationRoles';
import NotificationItem from './NotificationItem';

const NotificationBell: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'unread' | 'read'>('unread');
  const { notifications, markAllAsRead, markAsRead } = useNotifications();
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  // 다중 역할이면 현재 역할 알림만 — 전체 알림 화면의 역할 분리와 동일 기준.
  const roleScoped =
    user.availableRoles.length > 1
      ? notifications.filter((n) => rolesOf(n.type).includes(user.role))
      : notifications;
  const unreadCount = roleScoped.filter((n) => !n.isRead).length;

  // 최신순 정렬 보장 후 탭별 필터
  const sorted = [...roleScoped].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const filtered =
    tab === 'unread'
      ? sorted.filter((n) => !n.isRead)
      : sorted.filter((n) => n.isRead).slice(0, 5);

  // 다중 역할이면 "모두 읽음"도 현재 역할 알림만 처리.
  const handleMarkAllRead = () => {
    if (user.availableRoles.length > 1) {
      for (const n of roleScoped) if (!n.isRead) void markAsRead(n.id);
    } else {
      void markAllAsRead();
    }
  };

  const handleViewAll = () => {
    setOpen(false);
    navigate('/notifications');
  };

  // 알림 클릭 딥링크 — 팝오버를 닫고 이동. 벨은 현재 역할 알림만 보여주므로 역할 전환은 불필요.
  const handleItemNavigate = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* 알림창 열렸을 때 나머지 화면 어둡게 (백드롭) */}
      {open && (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            // 오버레이 스크림 — 모달과 동일한 웜 잉크 틴트로 통일
            background: 'hsl(26 14% 8% / 0.5)',
            zIndex: 40,
          }}
        />
      )}
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`알림 ${unreadCount}건`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ok-orange)]"
        >
          <Bell size={18} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--fg)' }} />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none"
              style={{
                background: 'var(--ok-orange-solid)',
                color: '#fff',
                border: '2px solid var(--bg-card)',
              }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[380px] p-0"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'unread' | 'read')}>
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <TabsList className="h-8 bg-transparent p-0 gap-1">
              <TabsTrigger value="unread" className="h-7 px-3 text-sm">
                읽지 않음
                {unreadCount > 0 && (
                  <Badge
                    className="ml-1.5 h-5 min-w-5 justify-center px-1.5 text-[10px]"
                    style={{ background: 'var(--ok-orange-solid)', color: '#fff', border: 'none' }}
                  >
                    {unreadCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="read" className="h-7 px-3 text-sm">
                읽음
              </TabsTrigger>
            </TabsList>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium hover:underline"
                style={{ color: 'var(--fg-muted)' }}
              >
                모두 읽음
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div
                className="flex flex-col items-center gap-2 px-3 py-10 text-center text-sm"
                style={{ color: 'var(--fg-muted)' }}
              >
                <Inbox size={22} style={{ color: 'var(--fg-subtle)' }} aria-hidden="true" />
                {tab === 'unread' ? '읽지 않은 알림이 없습니다.' : '읽은 알림이 없습니다.'}
              </div>
            ) : (
              <>
                {filtered.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onMarkAsRead={markAsRead}
                    currentRole={user.role}
                    onNavigate={handleItemNavigate}
                  />
                ))}
                {tab === 'read' && (
                  <div
                    className="px-3 py-2 text-center text-[11px]"
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    최근 읽은 알림 {filtered.length}건만 표시됩니다.
                  </div>
                )}
              </>
            )}
          </div>
        </Tabs>

        <div style={{ borderTop: '1px solid var(--border)' }} className="px-3 py-2">
          <button
            type="button"
            onClick={handleViewAll}
            className="w-full rounded-md py-2 text-sm font-semibold transition-colors hover:bg-[var(--ok-orange-50)]"
            style={{ color: 'var(--ok-orange)' }}
          >
            전체 알림 보기
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
