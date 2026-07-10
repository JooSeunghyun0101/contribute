import { apiFetch } from '@/lib/api';
import { Setting } from '@/types';

// 설정은 Express(/api/settings·/api/setting)를 경유한다.
// (과거 버전은 클라이언트에서 pg pool 을 직접 참조했으나 브라우저에선 MockPool 이라
//  저장·조회가 무동작이었다 — settings 테이블이 비어 있던 원인. apiFetch 로 복구.)
export const settingService = {
  // 사용자 설정 조회 (없으면 null)
  async getUserSetting(userId: string, settingType: string): Promise<Setting | null> {
    return apiFetch<Setting | null>(
      `/api/settings/${encodeURIComponent(userId)}/${encodeURIComponent(settingType)}`,
    );
  },

  // 사용자 설정 저장 / 업데이트 (upsert)
  async saveSetting(userId: string, settingType: string, settingData: unknown): Promise<Setting> {
    return apiFetch<Setting>('/api/setting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        setting_type: settingType,
        setting_data: settingData,
      }),
    });
  },

  // 사용자 전체 설정 조회
  async getUserSettings(userId: string): Promise<Setting[]> {
    return apiFetch<Setting[]>(`/api/settings/${encodeURIComponent(userId)}`);
  },

  // 특정 설정 삭제
  async deleteSetting(userId: string, settingType: string): Promise<void> {
    await apiFetch(`/api/setting/${encodeURIComponent(userId)}/${encodeURIComponent(settingType)}`, {
      method: 'DELETE',
    });
  },

  // 사용자의 모든 설정 삭제 (전용 엔드포인트가 없으므로 개별 삭제)
  async deleteAllUserSettings(userId: string): Promise<void> {
    const settings = await this.getUserSettings(userId);
    await Promise.all(settings.map((s: { setting_type: string }) => this.deleteSetting(userId, s.setting_type)));
  },
};
