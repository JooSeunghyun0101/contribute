import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle
} from '@/components/ui/dialog';
import { 
  Send, 
  Bot, 
  User, 
  Edit3, 
  Loader2,
  MessageSquare,
  AlertTriangle,
  CheckCircle
} from 'lucide-react';
import { 
  generateFeedbackRecommendation, 
  improveFeedback, 
  chatWithAI,
  ChatMessage 
} from '@/lib/gptOss';
import { Task } from '@/types/evaluation';

interface AIFeedbackChatProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task;
  currentFeedback: string;
  onApplyFeedback: (feedback: string) => void;
  existingFeedbacks?: string[];
}

interface ChatMessageWithId extends ChatMessage {
  id: string;
  timestamp: Date;
  isApplicable?: boolean; // 피드백에 반영 가능한 메시지인지
  feedbackContent?: string; // 반영할 피드백 내용
}

const AIFeedbackChat: React.FC<AIFeedbackChatProps> = ({
  isOpen,
  onClose,
  task,
  currentFeedback,
  onApplyFeedback,
  existingFeedbacks = []
}) => {
  const [messages, setMessages] = useState<ChatMessageWithId[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // 초기 메시지 설정
  useEffect(() => {
    if (isOpen) {
      const initialMessage: ChatMessageWithId = {
        id: '1',
        role: 'assistant',
        content: `안녕하세요! "${task.title}" 과업에 대한 피드백 작성을 도와드리겠습니다. 

다음 중 원하시는 기능을 선택하거나 직접 질문해주세요:

✏️ **문장교정**: 작성하신 피드백의 문법을 개선하고 오탈자를 수정해드립니다

💬 **자유 질문**: 피드백 작성에 대한 간단한 질문을 해주세요`,
        timestamp: new Date()
      };
      setMessages([initialMessage]);
    }
  }, [isOpen, task.title]);

  // 스크롤을 맨 아래로 이동
  useEffect(() => {
    const scrollToBottom = () => {
      if (scrollAreaRef.current) {
        scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
      }
    };
    
    // 메시지가 추가된 후 즉시 스크롤
    const timeoutId = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timeoutId);
  }, [messages]);

  const addMessage = (content: string, role: 'user' | 'assistant', isApplicable?: boolean, feedbackContent?: string) => {
    const newMessage: ChatMessageWithId = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date(),
      isApplicable,
      feedbackContent
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    addMessage(userMessage, 'user');
    setIsLoading(true);

    try {
      let response: string;
      let isApplicable = false;
      let feedbackContent = '';

      // 특정 명령어 처리
      if (userMessage.includes('개선') || userMessage.includes('교정') || userMessage.includes('문장교정')) {
        if (!currentFeedback.trim()) {
          response = '교정할 피드백이 없습니다. 먼저 피드백을 작성해주세요.';
        } else {
          response = await improveFeedback(
            currentFeedback,
            task.title,
            task.score || 0
          );
          isApplicable = true;
          feedbackContent = response;
        }
      } else {
        // 일반적인 AI 채팅
        response = await chatWithAI(userMessage, {
          taskTitle: task.title,
          taskDescription: task.description,
          score: task.score,
          contributionMethod: task.contributionMethod,
          contributionScope: task.contributionScope
        });
      }

      addMessage(response, 'assistant', isApplicable, feedbackContent);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      addMessage(`❌ ${errorMessage}`, 'assistant');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = async (action: string) => {
    setIsLoading(true);
    try {
      let response: string;
      let isApplicable = false;
      let feedbackContent = '';

      switch (action) {
        case 'improve':
          addMessage('문장교정을 요청했습니다.', 'user');
          if (!currentFeedback.trim()) {
            response = '교정할 피드백이 없습니다. 먼저 피드백을 작성해주세요.';
          } else {
            response = await improveFeedback(
              currentFeedback,
              task.title,
              task.score || 0
            );
            isApplicable = true;
            feedbackContent = response;
          }
          break;
        
        default:
          response = '알 수 없는 명령입니다.';
      }

      addMessage(response, 'assistant', isApplicable, feedbackContent);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      addMessage(`❌ ${errorMessage}`, 'assistant');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyFeedback = (feedbackContent: string) => {
    if (feedbackContent.trim()) {
      onApplyFeedback(feedbackContent);
      onClose();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col animate-in slide-in-from-bottom-4 duration-300">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            AI 피드백 어시스턴트
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col">
          {/* 빠른 액션 버튼들 */}
          <div className="flex flex-wrap gap-2 mb-4 p-3 bg-muted/30 rounded-lg animate-in fade-in duration-500 delay-200">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleQuickAction('improve')}
              disabled={isLoading}
              className="text-xs"
            >
              <Edit3 className="w-3 h-3 mr-1" />
              문장교정
            </Button>
          </div>

          {/* 채팅 메시지 영역 - 스크롤 개선 */}
          <div className="flex-1 overflow-hidden min-h-0">
            <ScrollArea ref={scrollAreaRef} className="h-[300px] pr-4">
              <div className="space-y-4 p-1">
                {messages.map((message) => (
                  <div key={message.id} className="flex gap-3">
                    <div className="flex-shrink-0">
                      {message.role === 'assistant' && (
                        <div className="w-8 h-8 bg-primary/15 rounded-full flex items-center justify-center flex-shrink-0">
                          <Bot className="w-4 h-4 text-primary" />
                        </div>
                      )}
                      {message.role === 'user' && (
                        <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center flex-shrink-0">
                          <User className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div
                        className={`max-w-[80%] p-3 rounded-lg ${
                          message.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-foreground'
                        }`}
                      >
                        <div className="whitespace-pre-wrap text-sm break-words">{message.content}</div>
                        <div className={`text-xs mt-1 ${
                          message.role === 'user' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        }`}>
                          {message.timestamp.toLocaleTimeString('ko-KR', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </div>
                    </div>
                    
                    {/* 피드백 반영 버튼 - AI 응답에만 표시 */}
                    {message.role === 'assistant' && message.isApplicable && message.feedbackContent && (
                      <div className="flex justify-start ml-11">
                        <Button
                          size="sm"
                          onClick={() => handleApplyFeedback(message.feedbackContent!)}
                          className="bg-primary hover:bg-primary/90 text-primary-foreground transition-all duration-200"
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />
                          이 내용을 피드백에 반영
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-3 justify-start">
                    <div className="w-8 h-8 bg-primary/15 rounded-full flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                    <div className="bg-muted p-3 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">AI가 응답을 생성하고 있습니다...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* 입력 영역 */}
          <div className="flex gap-2 mt-3">
            <Textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="피드백에 대해 질문하거나 도움을 요청하세요... (예: '문장교정')"
              className="flex-1 resize-none"
              rows={2}
              disabled={isLoading}
            />
            <Button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim() || isLoading}
              className="px-4"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>

          {/* 안내 메시지 */}
          <div className="mt-1 text-xs text-muted-foreground text-center">
            💡 팁: '문장교정'을 입력하거나 위의 버튼을 클릭하세요
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AIFeedbackChat; 