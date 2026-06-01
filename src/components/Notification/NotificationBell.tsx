import React, { useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContextDB';
import NotificationItem from './NotificationItem';

const NotificationBell: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'unread' | 'read'>('unread');
  const { notifications, unreadCount, markAllAsRead, markAsRead } = useNotifications();
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  // 최신순 정렬 보장 후 탭별 필터
  const sorted = [...notifications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const filtered =
    tab === 'unread'
      ? sorted.filter((n) => !n.isRead)
      : sorted.filter((n) => n.isRead).slice(0, 5);

  const handleViewAll = () => {
    setOpen(false);
    navigate('/notifications');
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
            background: 'rgba(0, 0, 0, 0.32)',
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
                background: 'var(--ok-orange)',
                color: '#fff',
                border: '2px solid var(--bg-card, #fff)',
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
                    style={{ background: 'var(--ok-orange)', color: '#fff', border: 'none' }}
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
                onClick={markAllAsRead}
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
                className="px-3 py-10 text-center text-sm"
                style={{ color: 'var(--fg-muted)' }}
              >
                {tab === 'unread' ? '읽지 않은 알림이 없습니다.' : '읽은 알림이 없습니다.'}
              </div>
            ) : (
              <>
                {filtered.map((n) => (
                  <NotificationItem key={n.id} notification={n} onMarkAsRead={markAsRead} />
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
