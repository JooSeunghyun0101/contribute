/**
 * 알림 채널 dispatch 추상화 (린 버전 — 큐/리트라이/팩토리 없음).
 *
 * 독려·리마인드 센터를 비롯해 다채널 발송이 필요한 곳은 이 모듈의
 * `dispatchNotifications` 만 호출한다. 컴포넌트가 직접 apiFetch/createNotification 을
 * 호출하지 않고 이 서비스 레이어를 경유한다.
 *
 * 어댑터는 현재 2개:
 *  - inApp  : notificationService.createNotification 으로 실제 인앱 알림 생성.
 *  - email  : 미설정 stub. 외부 호출/SMTP/신규 의존성 0. 향후 확장점만 마련.
 *
 * 발송 결과는 채널·수신자별로 격리되어 DispatchResult[] 로 집계된다.
 * 한 건이 실패해도 전체를 중단하지 않는다(부분 실패 허용).
 */
import { notificationService } from '@/lib/services';
import type { Notification } from '@/types';

/** 지원 채널. 신규 채널은 여기와 channelAdapters 에만 추가하면 된다. */
export type NotificationChannel = 'inApp' | 'email';

/**
 * dispatch 가 받는 발송 페이로드.
 *
 * notificationService.createNotification 의 인자 타입과 **구조적으로 동일**해야 한다.
 * 그 시그니처는 `Omit<Notification, 'id' | 'created_at'>` 이며 여기서 Notification 은
 * snake_case DB 타입(@/types/index.ts)이다. notification_type 은 'reminder' | 'notice' 로 좁힌다.
 * (DB notifications.notification_type 는 CHECK 제약이 없어 두 값 모두 그대로 통과한다.)
 *
 * 'reminder' : 독려·리마인드 센터(F-C1) 발송분.
 * 'notice'   : 일괄 공지(F-C5) 발송분. 두 도메인은 type 으로 격리되며,
 *              각 호출부가 자기 type 으로만 중복가드를 수행한다.
 */
export type DispatchPayload = Omit<Notification, 'id' | 'created_at' | 'notification_type'> & {
  notification_type: 'reminder' | 'notice';
};

/** 한 채널·한 수신자에 대한 발송 결과. */
export interface DispatchResult {
  channel: NotificationChannel;
  recipientId: string;
  /**
   * sent    : 실제로 발송됨.
   * skipped : 채널 미설정 등으로 의도적으로 건너뜀(실패 아님).
   * failed  : 발송 시도 중 오류.
   */
  outcome: 'sent' | 'skipped' | 'failed';
  /** skipped/failed 사유, 또는 발송된 알림 id 등 부가 정보. */
  reason?: string;
  /** inApp 발송 성공 시 생성된 알림 id. */
  notificationId?: string;
}

interface ChannelAdapter {
  channel: NotificationChannel;
  send: (payload: DispatchPayload) => Promise<DispatchResult>;
}

/**
 * 인앱 어댑터 — 실제 동작. createNotification 으로 notifications 행을 생성한다.
 * POST 응답은 서버가 rows[0] 원본(snake_case)을 그대로 반환하므로
 * created.id / created.recipient_id 로 읽는다(camelCase 아님).
 */
const inAppAdapter: ChannelAdapter = {
  channel: 'inApp',
  async send(payload) {
    try {
      const created = await notificationService.createNotification(payload);
      return {
        channel: 'inApp',
        recipientId: payload.recipient_id,
        outcome: 'sent',
        notificationId: created.id,
      };
    } catch (error) {
      return {
        channel: 'inApp',
        recipientId: payload.recipient_id,
        outcome: 'failed',
        reason: error instanceof Error ? error.message : '인앱 알림 생성 실패',
      };
    }
  },
};

/**
 * 이메일 어댑터 — 미설정 stub(확장점). 실제 외부호출/SMTP/신규 의존성 0.
 * 항상 skipped 를 반환한다.
 *
 * 향후 실제 이메일 발송을 붙일 때의 게이팅 지점:
 *   NotificationSettings.emailNotifications === true && isConfigured
 * 위 조건이 충족되면 send 내부에서 실제 메일 전송을 수행하도록 교체한다.
 */
const emailAdapter: ChannelAdapter = {
  channel: 'email',
  // 미설정 하드코딩. 실제 채널 연동 전까지 항상 skipped.
  // 향후 게이팅: NotificationSettings.emailNotifications === true && isConfigured 일 때만
  // 이 send 내부에서 실제 메일 전송으로 교체한다.
  async send(payload) {
    return {
      channel: 'email',
      recipientId: payload.recipient_id,
      outcome: 'skipped',
      reason: '이메일 채널 미설정',
    };
  },
};

const channelAdapters: Record<NotificationChannel, ChannelAdapter> = {
  inApp: inAppAdapter,
  email: emailAdapter,
};

/**
 * 페이로드들을 지정 채널들로 발송한다.
 *
 * - 채널 × 페이로드를 **순차 await** 로 처리한다(병렬 폭주 금지 — 8fc884c 교훈).
 * - 각 send 는 try/catch 로 격리되어 한 건 실패가 전체를 멈추지 않는다.
 * - 호출부(UI)는 사전에 수신자 dedup·중복가드를 끝내고 payloads 를 넘긴다.
 *   이 함수는 발송만 책임지며 중복 판정을 하지 않는다.
 *
 * @returns 채널·수신자별 DispatchResult 배열.
 */
export const dispatchNotifications = async (
  payloads: DispatchPayload[],
  channels: NotificationChannel[],
): Promise<DispatchResult[]> => {
  const results: DispatchResult[] = [];
  for (const payload of payloads) {
    for (const channel of channels) {
      const adapter = channelAdapters[channel];
      if (!adapter) {
        results.push({
          channel,
          recipientId: payload.recipient_id,
          outcome: 'failed',
          reason: `알 수 없는 채널: ${channel}`,
        });
        continue;
      }
      try {
        results.push(await adapter.send(payload));
      } catch (error) {
        results.push({
          channel,
          recipientId: payload.recipient_id,
          outcome: 'failed',
          reason: error instanceof Error ? error.message : '발송 중 오류',
        });
      }
    }
  }
  return results;
};
