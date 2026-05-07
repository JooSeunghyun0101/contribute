
import React, { useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle, AlertCircle, MessageSquare, Edit, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Notification } from '@/types/notification';

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}

const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onMarkAsRead,
  onDelete
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getIcon = () => {
    switch (notification.type) {
      case 'score_changed':
        return <Star className="h-4 w-4 text-amber-400" />;
      case 'task_content_changed':
        return <Edit className="h-4 w-4 text-primary" />;
      case 'feedback_added':
        return <MessageSquare className="h-4 w-4 text-emerald-400" />;
      case 'task_summary':
        return <Edit className="h-4 w-4 text-primary" />;
      case 'evaluation_completed':
        return <CheckCircle className="h-4 w-4 text-emerald-400" />;
      case 'evaluation_updated':
      case 'task_updated':
        return <AlertCircle className="h-4 w-4 text-primary" />;
      default:
        return <img src="/느낌표_orange.png" alt="Notification" className="h-7 w-7" />;
    }
  };

  const getPriorityColor = () => {
    if (notification.isRead) {
      return 'border-border bg-card';
    }

    // 모든 읽지 않은 알림을 노란색으로 통일
    return 'border-primary/20 bg-primary/5';
  };

  const shouldTruncate = notification.message.length > 300;
  const displayMessage = shouldTruncate && !isExpanded 
    ? notification.message.substring(0, 300) + '...' 
    : notification.message;

  return (
    <div className={`p-4 border rounded-lg ${getPriorityColor()}`}>
      <div className="flex flex-col gap-3">
        {/* 상단: 아이콘, 제목, 뱃지 */}
        <div className="flex items-start gap-3">
          {getIcon()}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h4 className="font-medium text-sm break-words flex-1 min-w-0">{notification.title}</h4>
              {!notification.isRead && (
                <Badge variant="secondary" className="text-xs px-2 py-0.5 bg-primary text-primary-foreground hover:bg-primary/90 flex-shrink-0">new</Badge>
              )}
            </div>
          </div>
        </div>
        
        {/* 중간: 메시지 내용 - 아이콘 간격만큼 들여쓰기 */}
        <div className="text-sm text-foreground space-y-1 pl-11">
          <div className="whitespace-pre-wrap break-words leading-relaxed word-break-break-all">
            {displayMessage}
          </div>
          {shouldTruncate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-auto p-0 text-primary hover:text-primary/80 text-xs"
            >
              {isExpanded ? '접기' : '더보기'}
            </Button>
          )}
        </div>
        
        {/* 하단: 메타정보와 액션 버튼들 */}
        <div className="flex items-center justify-between gap-2 pl-11 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0 flex-1">
            <span className="break-words">{notification.senderName}</span>
            <span>•</span>
            <span className="whitespace-nowrap">{format(new Date(notification.createdAt), 'MM/dd HH:mm')}</span>
          </div>
          
          <div className="flex items-center gap-1 flex-shrink-0">
            {!notification.isRead && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onMarkAsRead(notification.id)}
                className="text-xs px-2 py-1 h-auto whitespace-nowrap"
              >
                읽음
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(notification.id)}
              className="text-xs px-2 py-1 h-auto text-destructive hover:text-destructive/80 whitespace-nowrap"
            >
              삭제
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationItem;
