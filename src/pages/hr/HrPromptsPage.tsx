import PageHeader from '@/components/Layout/PageHeader';
import { PromptManagement } from '@/components/Settings/PromptManagement';

const HrPromptsPage = () => {
  return (
    <>
      <PageHeader
        title="AI 프롬프트 관리"
        subtitle="평가 의견 검수 · 피드백 생성 · 문장 교정 등 AI 기능별 프롬프트 확인 및 수정"
      />

      <div style={{ padding: '24px 32px 32px' }}>
        <PromptManagement showClose={false} />
      </div>
    </>
  );
};

export default HrPromptsPage;
