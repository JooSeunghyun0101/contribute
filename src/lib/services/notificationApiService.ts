import { apiFetch } from '@/lib/api';
import { Notification } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';

export const notificationService = {
  // 알림 목록 조회
  async getNotifications(): Promise<Notification[]> {
    try {
      return await apiFetch<Notification[]>('/api/notifications');
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 알림 생성
  async createNotification(notification: Omit<Notification, 'id' | 'created_at'>): Promise<Notification> {
    try {
      return await apiFetch<Notification>('/api/notification', {
        method: 'POST',
        body: JSON.stringify(notification),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 알림 읽음 처리
  async markAsRead(notificationId: string): Promise<void> {
    try {
      await apiFetch<void>(`/api/notification/${notificationId}/read`, {
        method: 'PUT',
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 알림 삭제
  async deleteNotification(notificationId: string): Promise<void> {
    try {
      await apiFetch<void>(`/api/notification/${notificationId}`, {
        method: 'DELETE',
      });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 사용자별 알림 조회
  async getNotificationsByRecipientId(userId: string): Promise<Notification[]> {
    const all = await this.getNotifications();
    return all.filter((n) => n.recipient_id === userId);
  },

  // 모든 알림을 읽음 처리
  async markAllAsRead(userId: string): Promise<void> {
    const notifications = await this.getNotificationsByRecipientId(userId);
    await Promise.all(notifications.map((n) => this.markAsRead(n.id)));
  },

  // 모든 알림 삭제
  async deleteAllNotifications(userId: string): Promise<void> {
    const notifications = await this.getNotificationsByRecipientId(userId);
    await Promise.all(notifications.map((n) => this.deleteNotification(n.id)));
  },
};