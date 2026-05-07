import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { testGeminiConnection, checkGeminiKey, generateFeedbackRecommendation } from '@/lib/gptOss';

export const GeminiTest: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [testResult, setTestResult] = useState<string>('');
  const [feedbackTest, setFeedbackTest] = useState<string>('');

  const handleConnectionTest = async () => {
    setIsLoading(true);
    setTestResult('');

    try {
      console.log('🧪 Gemini 연결 테스트 시작...');
      
      // API 키 확인
      const hasKey = checkGeminiKey();
      if (!hasKey) {
        setTestResult('❌ API 키가 설정되지 않았습니다.');
        return;
      }

      // 연결 테스트
      const result = await testGeminiConnection();
      if (result.success) {
        setTestResult(`✅ LLM API 연결 성공!\n\nAI 응답: ${result.response}`);
      } else {
        setTestResult(`❌ LLM API 연결 실패\n\n오류 내용: ${result.error}\n\n🔧 해결 방법:\n• API가 활성화되어 있는지 확인하세요`);
      }
    } catch (error) {
      console.error('연결 테스트 오류:', error);
      setTestResult(`❌ 연결 테스트 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeedbackTest = async () => {
    setIsLoading(true);
    setFeedbackTest('');

    try {
      console.log('🤖 피드백 생성 테스트 시작...');
      
      const feedback = await generateFeedbackRecommendation(
        '프로젝트 관리',
        '신규 웹 애플리케이션 개발 프로젝트의 전체적인 관리 및 팀 리딩',
        3,
        '리딩',
        '독립적'
      );

      setFeedbackTest(feedback);
    } catch (error) {
      console.error('피드백 생성 오류:', error);
      setFeedbackTest(`❌ 피드백 생성 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto mb-6">
      <CardHeader>
        <CardTitle>🤖 LLM 테스트</CardTitle>
        <CardDescription>
          API 연결 상태와 AI 피드백 기능을 테스트합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-4">
          <Button 
            onClick={handleConnectionTest} 
            disabled={isLoading}
            variant="outline"
          >
            {isLoading ? '테스트 중...' : '연결 테스트'}
          </Button>
          
          <Button 
            onClick={handleFeedbackTest} 
            disabled={isLoading}
            variant="outline"
          >
            {isLoading ? '생성 중...' : '피드백 생성 테스트'}
          </Button>
        </div>

        {testResult && (
          <div className="p-3 bg-gray-50 rounded-md">
            <h4 className="font-medium mb-2">연결 테스트 결과:</h4>
            <p className="text-sm">{testResult}</p>
          </div>
        )}

        {feedbackTest && (
          <div className="p-3 bg-blue-50 rounded-md">
            <h4 className="font-medium mb-2">피드백 생성 테스트 결과:</h4>
            <p className="text-sm whitespace-pre-wrap">{feedbackTest}</p>
          </div>
        )}

        <div className="text-xs text-gray-500">
          <p>• 연결 테스트: LLM API와의 기본 통신을 확인합니다</p>
          <p>• 피드백 생성 테스트: AI 피드백 생성 기능을 확인합니다</p>
        </div>
      </CardContent>
    </Card>
  );
}; 