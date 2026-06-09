import PageHeader from '@/components/Layout/PageHeader';
import { PromptManagement } from '@/components/Settings/PromptManagement';
import { AiReviewMonitoring } from '@/components/Feedback/AiReviewMonitoring';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const HrPromptsPage = () => {
  return (
    <>
      <PageHeader
        title="AI 프롬프트 · 평가의견 검수 모니터링"
        subtitle="평가의견 품질 검수 모니터링과 AI 기능별 프롬프트 관리"
      />

      <div style={{ padding: '24px 32px 32px' }}>
        <Tabs defaultValue="review">
          <TabsList style={{ marginBottom: 20 }}>
            <TabsTrigger value="review">AI 검수 모니터링</TabsTrigger>
            <TabsTrigger value="prompts">AI 프롬프트 관리</TabsTrigger>
          </TabsList>

          <TabsContent value="review">
            <AiReviewMonitoring />
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
