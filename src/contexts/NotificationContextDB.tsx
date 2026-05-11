import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Notification, NotificationContext as INotificationContext } from '@/types/notification';
import { notificationService } from '@/lib/services';
import { useAuth } from '@/contexts/AuthContext';

const NotificationContext = createContext<INotificationContext | undefined>(undefined);

interface NotificationProviderProps {
  children: React.ReactNode;
}

const toFrontend = (raw: any): Notification => ({
  id: raw.id,
  type: raw.notification_type,
  title: raw.title,
  message: raw.message,
  priority: raw.priority,
  senderId: raw.sender_id,
  senderName: raw.sender_name,
  recipientId: raw.recipient_id,
  relatedEvaluationId: raw.related_evaluation_id || undefined,
  relatedTaskId: raw.related_task_id || undefined,
  isRead: raw.is_read,
  createdAt: raw.created_at,
  readAt: undefined,
  lastModified: undefined,
});

export const NotificationProviderDB: React.FC<NotificationProviderProps> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const { user } = useAuth();

  const loadNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      return;
    }
    try {
      const dbNotifications = await notificationService.getNotificationsByRecipientId(user.employeeId);
      const formatted = dbNotifications.map(toFrontend);
      formatted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setNotifications(formatted);
    } catch (error) {
      console.error('알림 로드 실패:', error);
    }
  }, [user]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const addNotification = async (
    notificationData: Omit<Notification, 'id' | 'createdAt' | 'isRead'>,
  ) => {
    try {
      const dbNotification = await notificationService.createNotification({
        notification_type: notificationData.type,
        title: notificationData.title,
        message: notificationData.message,
        priority: notificationData.priority,
        sender_id: notificationData.senderId,
        sender_name: notificationData.senderName,
        recipient_id: notificationData.recipientId,
        related_evaluation_id: notificationData.relatedEvaluationId || null,
        related_task_id: notificationData.relatedTaskId || null,
        is_read: false,
      });

      if (user && dbNotification.recipient_id === user.employeeId) {
        setNotifications((prev) => [toFrontend(dbNotification), ...prev]);
      }
    } catch (error) {
      console.error('알림 생성 실패:', error);
      throw error;
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await notificationService.markAsRead(notificationId);
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, isRead: true, readAt: new Date().toISOString() } : n,
        ),
      );
    } catch (error) {
      console.error('알림 읽음 처리 실패:', error);
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;
    try {
      await notificationService.markAllAsRead(user.employeeId);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() })),
      );
    } catch (error) {
      console.error('모든 알림 읽음 처리 실패:', error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      await notificationService.deleteNotification(notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
    } catch (error) {
      console.error('알림 삭제 실패:', error);
    }
  };

  const deleteAllNotifications = async (userId: string) => {
    try {
      await notificationService.deleteAllNotifications(userId);
      if (user && userId === user.employeeId) {
        setNotifications([]);
      }
    } catch (error) {
      console.error('모든 알림 삭제 실패:', error);
    }
  };

  const cleanupOldNotifications = async () => {
    if (!user) return;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const stale = notifications.filter(
      (n) => n.isRead && new Date(n.createdAt).getTime() < thirtyDaysAgo,
    );
    for (const n of stale) {
      await deleteNotification(n.id);
    }
  };

  const getNotificationsForUser = (_userId: string): Notification[] => notifications;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const contextValue: INotificationContext = {
    notifications,
    unreadCount,
    addNotification,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteAllNotifications,
    cleanupOldNotifications,
    getNotificationsForUser,
  };

  return (
    <NotificationContext.Provider value={contextValue}>{children}</NotificationContext.Provider>
  );
};

export const useNotifications = (): INotificationContext => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
