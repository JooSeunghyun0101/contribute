import { QnaAssistant } from '@/components/QnaAssistant';
import { useAuth } from '@/contexts/AuthContext';
import { askEvaluatorQuestion } from '@/lib/gptOss';

const EvaluatorQnaPage = () => {
  const { user } = useAuth();
  return (
    <QnaAssistant
      subtitle="평가 진행 중 발생하는 질문을 AI가 답해 드립니다"
      welcome={`${
        user?.name ? `${user.name}님 ` : ''
      }평가 진행 중 궁금한 점을 편하게 물어봐 주세요.\n• 점수 매트릭스 해석\n• 가중치·기여 방식·범위 정의\n• 피드백 작성 가이드\n• 시스템 운영 절차 등`}
      placeholder="평가 기준·운영·피드백 작성에 대해 질문해 보세요. (Enter로 전송, Shift+Enter 줄바꿈)"
      askFn={askEvaluatorQuestion}
    />
  );
};

export default EvaluatorQnaPage;
