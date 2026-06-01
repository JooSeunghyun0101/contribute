import { useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { IconSparkle, IconSend } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';
import { askEvaluatorQuestion, type EvaluatorQnaTurn } from '@/lib/gptOss';
import { useToast } from '@/hooks/use-toast';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  error?: boolean;
};

const STARTERS = [
  '점수 매트릭스에서 4점이 나오는 조합을 알려주세요.',
  '가중치 합이 100%가 안 되면 어떻게 처리하나요?',
  '피드백을 작성할 때 구체적으로 어떤 내용을 담아야 하나요?',
  '기여 방식 4단계는 각각 어떤 차이가 있나요?',
];

const formatTime = () => {
  const d = new Date();
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
};

const EvaluatorQnaPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // 첫 진입 안내 메시지
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: `${
            user?.name ? `${user.name}님 ` : ''
          }평가 진행 중 궁금한 점을 편하게 물어봐 주세요.\n• 점수 매트릭스 해석\n• 가중치·기여 방식·범위 정의\n• 피드백 작성 가이드\n• 시스템 운영 절차 등`,
        },
      ]);
    }
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

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    const pendingMsg: Message = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '답변 생성 중…',
      pending: true,
    };

    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setInput('');
    setIsSending(true);

    try {
      const reply = await askEvaluatorQuestion(trimmed, conversationHistory);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id ? { ...m, content: reply, pending: false } : m,
        ),
      );
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
      toast({
        title: 'AI 응답 실패',
        description: '서버와 통신 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
      // 다음 질문에 포커스
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
      {
        id: 'welcome',
        role: 'assistant',
        content: '대화를 새로 시작했습니다. 무엇이 궁금한지 알려 주세요.',
      },
    ]);
  };

  return (
    <>
      <PageHeader
        title="AI 도움말"
        subtitle="평가 진행 중 발생하는 질문을 AI가 답해 드립니다"
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
          gridTemplateColumns: 'minmax(0, 1fr) 280px',
          gap: 20,
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* ── 채팅 영역 ─────────────────────────── */}
        <div
          className="sd-card sd-card-lg"
          style={{
            display: 'flex',
            flexDirection: 'column',
            padding: 0,
            minHeight: 480,
            overflow: 'hidden',
          }}
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
              background:
                'linear-gradient(180deg, var(--bg-card) 0%, var(--bg-muted) 100%)',
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
                placeholder="평가 기준·운영·피드백 작성에 대해 질문해 보세요. (Enter로 전송, Shift+Enter 줄바꿈)"
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

        {/* ── 사이드: 추천 질문 + 안내 ─────────── */}
        <div className="flex flex-col gap-4">
          <div className="sd-card sd-card-lg">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <IconSparkle size={16} style={{ color: 'var(--ok-orange)' }} />
              <h3 style={{ fontSize: 'var(--fs-body)', fontWeight: 800 }}>추천 질문</h3>
            </div>
            <div className="flex flex-col gap-2">
              {STARTERS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  disabled={isSending}
                  style={{
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-muted)',
                    fontSize: 'var(--fs-sm)',
                    lineHeight: 1.55,
                    cursor: isSending ? 'not-allowed' : 'pointer',
                    color: 'var(--fg)',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div
            className="sd-card"
            style={{
              background: 'var(--ok-orange-50)',
              border: '1px solid var(--ok-orange-100)',
            }}
          >
            <div className="sd-label-mini" style={{ color: 'var(--ok-brown)' }}>
              안내
            </div>
            <p
              style={{
                marginTop: 8,
                fontSize: 'var(--fs-sm)',
                lineHeight: 1.65,
                color: 'var(--ok-brown)',
              }}
            >
              AI 응답은 평가 의사결정의 참고 자료이며, 최종 점수와 평가 결정은 평가자 본인이 내려야 합니다.
              프롬프트는 HR 관리자 화면(<b>AI 프롬프트</b> ·{' '}
              <code style={{ fontSize: 'var(--fs-xs)' }}>evaluator_qna_assistant</code>)에서 확인·수정할 수 있습니다.
            </p>
          </div>
        </div>
      </div>
    </>
  );
};

const MessageBubble = ({ message }: { message: Message }) => {
  const isUser = message.role === 'user';
  const align = isUser ? 'flex-end' : 'flex-start';
  const bg = message.error
    ? 'rgba(220,69,69,0.08)'
    : isUser
      ? 'var(--ok-orange)'
      : 'var(--bg-card)';
  const color = message.error
    ? 'var(--danger)'
    : isUser
      ? '#fff'
      : 'var(--fg)';
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

export default EvaluatorQnaPage;
