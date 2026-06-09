import PageHeader from '@/components/Layout/PageHeader';
import { PromptManagement } from '@/components/Settings/PromptManagement';
import { AiReviewMonitoring } from '@/components/Feedback/AiReviewMonitoring';
import { FeedbackDuplicateDetector } from '@/components/Feedback/FeedbackDuplicateDetector';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const HrPromptsPage = () => {
  return (
    <>
      <PageHeader
        title="AI 품질 · 검수"
        subtitle="평가의견 품질 검수 모니터링, 복붙(중복) 탐지, AI 프롬프트 관리"
      />

      <div style={{ padding: '24px 32px 32px' }}>
        <Tabs defaultValue="review">
          <TabsList style={{ marginBottom: 20 }}>
            <TabsTrigger value="review">AI 검수 모니터링</TabsTrigger>
            <TabsTrigger value="duplicate">평가의견 중복 탐지</TabsTrigger>
            <TabsTrigger value="prompts">AI 프롬프트 관리</TabsTrigger>
          </TabsList>

          <TabsContent value="review">
            <AiReviewMonitoring />
          </TabsContent>

          <TabsContent value="duplicate">
            <FeedbackDuplicateDetector />
          </TabsContent>

          <TabsContent value="prompts">
            <PromptManagement showClose={false} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
};

export default HrPromptsPage;
