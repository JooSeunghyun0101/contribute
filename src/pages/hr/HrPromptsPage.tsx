import { useEffect, useState } from 'react';
import PageHeader from '@/components/Layout/PageHeader';
import { PromptManagement } from '@/components/Settings/PromptManagement';
import { AiReviewMonitoring } from '@/components/Feedback/AiReviewMonitoring';
import { FeedbackDuplicateDetector } from '@/components/Feedback/FeedbackDuplicateDetector';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchAiStatus, type AiStatus } from '@/lib/gptOss';

const HrPromptsPage = () => {
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAiStatus().then((status) => {
      if (!cancelled) setAiStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="AI 품질 · 검수"
        subtitle="평가의견 품질 검수 모니터링, 복붙(중복) 탐지, AI 프롬프트 관리"
      />

      <div style={{ padding: '24px 32px 32px' }}>
        {/* AI 연동 상태 안내 — 외부 API(임시) 사용 중에는 민감 원문 전송 주의를 상시 노출(B-1c).
            내부망 GPT-OSS 이식(AI_BASE_URL 전환) 시 external=false 가 되어 자동으로 사라진다. */}
        {aiStatus && !aiStatus.configured && (
          <div
            className="sd-card"
            style={{
              marginBottom: 16,
              background: 'var(--info-bg)',
              border: '1px solid var(--border)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--fg)',
              lineHeight: 1.6,
            }}
          >
            <b>AI 미설정</b> — 서버 <code>.env</code>에 AI 연동 정보(<code>AI_API_KEY</code> 또는{' '}
            <code>AI_BASE_URL</code>)를 설정하면 AI 검수·중복 탐지 기능이 활성화됩니다. 휴리스틱(길이·복붙
            해시) 점검은 AI 없이도 동작합니다.
          </div>
        )}
        {aiStatus?.configured && aiStatus.external && (
          <div
            className="sd-card"
            style={{
              marginBottom: 16,
              background: 'var(--warning-bg)',
              border: '1px solid var(--warning)',
              fontSize: 'var(--fs-sm)',
              color: 'var(--fg)',
              lineHeight: 1.6,
            }}
          >
            <b>임시 외부 AI 사용 중</b> — 현재 AI 검수는 외부 API(GitHub Models)로 동작하며, 검수 대상{' '}
            <b>평가의견 원문이 외부로 전송</b>됩니다. 실제 평가 데이터 검수는 내부망 AI(GPT-OSS) 이식 후
            사용을 권장합니다. (이식 시 이 안내는 자동으로 사라집니다)
          </div>
        )}

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
