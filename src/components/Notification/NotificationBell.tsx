import React, { useEffect, useState } from 'react';
import { useNotifications } from '@/contexts/NotificationContextDB';
import { useAuth } from '@/contexts/AuthContext';
import NotificationDropdown from './NotificationDropdown';

const NotificationBell: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { notifications, unreadCount } = useNotifications();
  const { user } = useAuth();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen]);

  if (!user) return null;

  return (
    <>
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.32)',
            zIndex: 40,
          }}
        />
      )}
      <div style={{ position: 'relative', zIndex: isOpen ? 50 : 'auto' }}>
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          style={{
            position: 'relative',
            width: 36,
            height: 36,
            padding: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          aria-label={`알림 ${unreadCount}건`}
        >
          <img src="/느낌표_orange.png" alt="" style={{ height: 24, width: 24 }} />
          {unreadCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                borderRadius: 9,
                background: 'var(--ok-orange)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '2px solid var(--bg-card, #fff)',
              }}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {isOpen && (
          <NotificationDropdown notifications={notifications} onClose={() => setIsOpen(false)} />
        )}
      </div>
    </>
  );
};

export default NotificationBell;
