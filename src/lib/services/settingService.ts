import { pool } from '@/lib/database';
import { Setting } from '@/types';
import { apiErrorHandler } from '@/utils/errorHandler';

export const settingService = {
  // 사용자 설정 조회
  async getUserSetting(userId: string, settingType: string): Promise<Setting | null> {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM settings WHERE user_id = $1 AND setting_type = $2 LIMIT 1',
        [userId, settingType]
      );
      return rows[0] ?? null;
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 사용자 설정 저장 / 업데이트 (upsert)
  async saveSetting(
    userId: string,
    settingType: string,
    settingData: any
  ): Promise<Setting> {
    try {
      const columns = ['user_id', 'setting_type', 'setting_data', 'updated_at'];
      const values = [userId, settingType, settingData, new Date().toISOString()];
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      const query = `
        INSERT INTO settings (${columns.join(', ')})
        VALUES (${placeholders})
        ON CONFLICT (user_id, setting_type) DO UPDATE
        SET setting_data = EXCLUDED.setting_data,
            updated_at = EXCLUDED.updated_at
        RETURNING *;
      `;
      const { rows } = await pool.query(query, values);
      return rows[0];
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 사용자 전체 설정 조회
  async getUserSettings(userId: string): Promise<Setting[]> {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM settings WHERE user_id = $1',
        [userId]
      );
      return rows;
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 특정 설정 삭제
  async deleteSetting(userId: string, settingType: string): Promise<void> {
    try {
      const { rowCount } = await pool.query(
        'DELETE FROM settings WHERE user_id = $1 AND setting_type = $2',
        [userId, settingType]
      );
      if (rowCount === 0) {
        throw new Error('No setting found to delete');
      }
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },

  // 사용자의 모든 설정 삭제
  async deleteAllUserSettings(userId: string): Promise<void> {
    try {
      await pool.query('DELETE FROM settings WHERE user_id = $1', [userId]);
    } catch (error) {
      throw apiErrorHandler.handleApiError(error);
    }
  },
};