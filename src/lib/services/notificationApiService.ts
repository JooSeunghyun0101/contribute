import { apiFetch } from '@/lib/api';
import { Notification } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';

export const notificationService = {
  async getNotifications(limit = 50): Promise<Notification[]> {
    try {
      return await apiFetch<Notification[]>(`/api/notifications?limit=${limit}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async getNotificationsByRecipientId(userId: string, limit = 50): Promise<Notification[]> {
    try {
      const params = new URLSearchParams({ recipientId: userId, limit: String(limit) });
      return await apiFetch<Notification[]>(`/api/notifications?${params.toString()}`);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

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

  async markAsRead(notificationId: string): Promise<void> {
    try {
      await apiFetch<void>(`/api/notification/${notificationId}/read`, { method: 'PUT' });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async deleteNotification(notificationId: string): Promise<void> {
    try {
      await apiFetch<void>(`/api/notification/${notificationId}`, { method: 'DELETE' });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async markAllAsRead(userId: string): Promise<void> {
    try {
      const params = new URLSearchParams({ recipientId: userId });
      await apiFetch<void>(`/api/notifications/read-all?${params.toString()}`, { method: 'PUT' });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  async deleteAllNotifications(userId: string): Promise<void> {
    try {
      const params = new URLSearchParams({ recipientId: userId });
      await apiFetch<void>(`/api/notifications?${params.toString()}`, { method: 'DELETE' });
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
};
