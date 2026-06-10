
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Bell, Mail } from 'lucide-react';

interface NotificationSettingsProps {
  onClose?: () => void;
  /** 설정 페이지에 인라인 임베드 시 모달 헤더(중복 제목·닫기)를 숨긴다. */
  embedded?: boolean;
}

// 알림은 현재 인앱(벨) 채널만 동작한다. 이메일 발송과 수신 세부 설정(주기·마감 사전알림 등)은
// 백엔드 미구현(보류)이며, 과거의 notification_config 토글들은 어떤 코드도 소비하지 않는 장식이었다.
// 동작하지 않는 설정을 노출하지 않고 채널 현황만 안내한다. (이메일 재개 시 git 이력의 구버전 참조)
export const NotificationSettings: React.FC<NotificationSettingsProps> = ({ onClose, embedded }) => {
  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">알림 설정</h2>
            <p className="text-muted-foreground">알림 채널 현황을 안내합니다</p>
          </div>
          <Button variant="outline" onClick={onClose}>
            <X className="mr-2 h-4 w-4" />
            닫기
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            시스템 내 알림
          </CardTitle>
          <CardDescription>
            리마인드·공지·재검토 요청 등 모든 알림은 화면 상단의 종 아이콘으로 전달됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            별도 설정 없이 항상 수신됩니다. 새 알림은 로그인 후 상단 알림에서 확인하세요.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            이메일 알림
            <Badge variant="secondary">준비 중</Badge>
          </CardTitle>
          <CardDescription>이메일 채널과 수신 주기 등 세부 설정은 추후 제공 예정입니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            이메일 발송 기능이 연결되면 이 화면에서 수신 여부와 주기를 설정할 수 있습니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
