import { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { HelpCircle } from 'lucide-react';
import { IconSparkle, IconSend } from '@/components/brand';
import { FaqSection } from '@/components/FaqSection';
import { useAuth } from '@/contexts/AuthContext';
import type { EvaluatorQnaTurn } from '@/lib/gptOss';
import { evaluatorQnaLogService } from '@/lib/services';
import { useToast } from '@/hooks/use-toast';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  error?: boolean;
};

export interface QnaAssistantProps {
  /** 화면 부제목 */
  subtitle: string;
  /** 첫 진입 환영 메시지 */
  welcome: string;
  /** 입력창 placeholder */
  placeholder: string;
  /** AI 호출 함수(평가자/피평가자 프롬프트 차이를 캡슐화) */
  askFn: (question: string, history: EvaluatorQnaTurn[]) => Promise<string>;
}

const formatTime = () => {
  const d = new Date();
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
};

/**
 * 평가자/피평가자 공통 AI 도움말 화면.
 * 채팅 UI·로깅·FAQ 노출은 동일하고, 시스템 프롬프트(askFn)와 안내 문구만 역할별로 주입한다.
 */
export const QnaAssistant = ({
  subtitle,
  welcome,
  placeholder,
  askFn,
}: QnaAssistantProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // 첫 진입 안내 메시지
  useEffect(() => {
    setMessages([{ id: 'welcome', role: 'assistant', content: welcome }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 메시지 추가 시 스크롤 하단 고정
  useEffect(() => {
    const node = scrollerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const conversationHistory = useMemo<EvaluatorQnaTurn[]>(
    () =>
      messages
        .filter((m) => !m.error && !m.pending && m.id !== 'welcome')
        .map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: trimmed };
    const pendingMsg: Message = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '답변 생성 중…',
      pending: true,
    };

    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setInput('');
    setIsSending(true);

    // 문의 1턴을 HR 감사용으로 보관(실패해도 사용자 경험에는 영향 없음).
    const logTurn = (answer: string | null, isError: boolean) => {
      if (!user?.employeeId) return;
      void evaluatorQnaLogService.create({
        user_id: user.employeeId,
        user_name: user.name ?? null,
        user_department: user.department ?? null,
        user_role: user.role ?? null,
        question: trimmed,
        answer,
        is_error: isError,
      });
    };

    try {
      const reply = await askFn(trimmed, conversationHistory);
      setMessages((prev) =>
        prev.map((m) => (m.id === pendingMsg.id ? { ...m, content: reply, pending: false } : m)),
      );
      logTurn(reply, false);
    } catch (error) {
      console.error('AI 응답 실패:', error);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id
            ? {
                ...m,
                content: 'AI 응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
                pending: false,
                error: true,
              }
            : m,
        ),
      );
      logTurn(null, true);
      toast({
        title: 'AI 응답 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const onClear = () => {
    if (isSending) return;
    setMessages([
      { id: 'welcome', role: 'assistant', content: '대화를 새로 시작했습니다. 무엇이 궁금한지 알려 주세요.' },
    ]);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        // 상단바를 제외한 높이를 꽉 채운다. 채팅·FAQ는 이 안에서 각자 내부 스크롤.
        height: 'calc(100vh - var(--topbar-h))',
      }}
    >
      <PageHeader
        title="AI 도움말"
        subtitle={subtitle}
        actions={
          <button
            type="button"
            className="sd-btn sd-btn-outline sd-btn-sm"
            onClick={onClear}
            disabled={isSending}
          >
            대화 초기화
          </button>
        }
      />

      <div
        style={{
          padding: '24px 32px 32px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(380px, 520px)',
          gap: 20,
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* ── 채팅 영역 ─────────────────────────── */}
        <div
          className="sd-card sd-card-lg"
          style={{ display: 'flex', flexDirection: 'column', padding: 0, minHeight: 0, height: '100%', overflow: 'hidden' }}
        >
          <div
            ref={scrollerRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              background: 'linear-gradient(180deg, var(--bg-card) 0%, var(--bg-muted) 100%)',
            }}
          >
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>

          <div style={{ padding: 16, borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                rows={2}
                disabled={isSending}
                style={{
                  flex: 1,
                  resize: 'none',
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  fontSize: 'var(--fs-body)',
                  lineHeight: 1.6,
                  color: 'var(--fg)',
                  fontFamily: 'inherit',
                }}
              />
              <button
                type="button"
                className="sd-btn sd-btn-primary"
                onClick={() => send(input)}
                disabled={!input.trim() || isSending}
                style={{
                  height: 44,
                  paddingLeft: 16,
                  paddingRight: 16,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <IconSend size={16} /> {isSending ? '전송 중…' : '전송'}
              </button>
            </div>
          </div>
        </div>

        {/* ── 우측 열: 자주 묻는 질문(FAQ) ───────── */}
        {/* HR이 '공지·FAQ'에서 등록한 FAQ. 없으면 안내 카드를 대신 표시해 열이 비어 보이지 않게 한다. */}
        <FaqSection
          style={{
            marginTop: 0,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            height: '100%',
            overflowY: 'auto',
          }}
          emptyFallback={
            <div
              className="sd-card sd-card-lg"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 0,
                height: '100%',
                gap: 8,
                textAlign: 'center',
                color: 'var(--fg-muted)',
              }}
            >
              <HelpCircle size={22} style={{ color: 'var(--ok-orange)' }} aria-hidden />
              <div style={{ fontSize: 'var(--fs-body)', fontWeight: 700 }}>등록된 FAQ가 없습니다</div>
              <div style={{ fontSize: 'var(--fs-sm)' }}>HR이 ‘공지·FAQ’에서 등록하면 여기에 표시됩니다.</div>
            </div>
          }
        />
      </div>
    </div>
  );
};

const MessageBubble = ({ message }: { message: Message }) => {
  const isUser = message.role === 'user';
  const align = isUser ? 'flex-end' : 'flex-start';
  const bg = message.error ? 'rgba(220,69,69,0.08)' : isUser ? 'var(--ok-orange)' : 'var(--bg-card)';
  const color = message.error ? 'var(--danger)' : isUser ? '#fff' : 'var(--fg)';
  const border = message.error
    ? '1px solid rgba(220,69,69,0.35)'
    : isUser
      ? 'none'
      : '1px solid var(--border)';

  return (
    <div style={{ display: 'flex', justifyContent: align }}>
      <div style={{ maxWidth: '78%' }}>
        {!isUser && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 4,
              fontSize: 'var(--fs-xs)',
              color: 'var(--fg-muted)',
              fontWeight: 700,
            }}
          >
            <IconSparkle size={12} style={{ color: 'var(--ok-orange)' }} /> AI 어시스턴트
          </div>
        )}
        <div
          className={!isUser && !message.error ? 'ai-shine-border' : undefined}
          style={{
            padding: '10px 14px',
            borderRadius: 14,
            background: bg,
            color,
            border,
            fontSize: 'var(--fs-body)',
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            boxShadow: !isUser && !message.error ? '0 1px 2px rgba(0,0,0,0.04)' : 'none',
            opacity: message.pending ? 0.7 : 1,
          }}
        >
          {message.content}
        </div>
        <div
          style={{
            fontSize: 'var(--fs-micro)',
            color: 'var(--fg-subtle)',
            marginTop: 4,
            textAlign: isUser ? 'right' : 'left',
          }}
        >
          {message.pending ? '⏳ 답변 생성 중' : formatTime()}
        </div>
      </div>
    </div>
  );
};

export default QnaAssistant;
