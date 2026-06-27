import { QnaAssistant } from '@/components/QnaAssistant';
import { useAuth } from '@/contexts/AuthContext';
import { askEvaluateeQuestion } from '@/lib/gptOss';

const MyQnaPage = () => {
  const { user } = useAuth();
  return (
    <QnaAssistant
      subtitle="과업 등록·성과보고·평가 이해에 대한 질문을 AI가 답해 드립니다"
      welcome={`${
        user?.name ? `${user.name}님 ` : ''
      }평가 준비 중 궁금한 점을 편하게 물어봐 주세요.\n• 과업 등록·가중치 배분\n• AI 과업 50% 규칙\n• 성과보고 작성 가이드\n• 받은 평가·피드백 해석`}
      placeholder="과업 등록·성과보고·평가 이해에 대해 질문해 보세요. (Enter로 전송, Shift+Enter 줄바꿈)"
      askFn={askEvaluateeQuestion}
    />
  );
};

export default MyQnaPage;
