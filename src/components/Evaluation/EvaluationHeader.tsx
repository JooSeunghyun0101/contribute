
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Save } from 'lucide-react';
import EvaluationSummary from './EvaluationSummary';
import { EvaluationData } from '@/types/evaluation';

interface EvaluationHeaderProps {
  evaluationData: EvaluationData;
  totalScore: number;
  exactScore: number;
  isAchieved: boolean;
  onGoBack: () => void;
  /** 평가 저장 로직을 실행합니다. 반환값은 저장 성공 여부를 나타내는 Promise<boolean> */
  onSave: () => Promise<boolean>;
}

const EvaluationHeader: React.FC<EvaluationHeaderProps> = ({
  evaluationData,
  totalScore,
  exactScore,
  isAchieved,
  onGoBack,
  onSave
}) => {
  const [isSaving, setIsSaving] = useState(false);

  return (
    <div className="sticky top-0 z-10 bg-background border-b border-border shadow-sm">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 sm:gap-4">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onGoBack}
              className="border-primary text-primary hover:bg-primary/10 px-2 sm:px-3"
            >
              <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">뒤로 가기</span>
              <span className="inline sm:hidden">뒤로</span>
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground">
                <span className="hidden sm:inline">성과 평가</span>
                <span className="inline sm:hidden">평가</span>
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                <span className="hidden sm:inline">팀원의 과업별 성과를 평가하세요</span>
                <span className="inline sm:hidden">과업별 성과 평가</span>
              </p>
            </div>
          </div>
          {/* 저장 버튼 – 비동기 호출을 보장하고 오류를 로깅 */}
          <Button
            disabled={isSaving}
            onClick={async () => {
              setIsSaving(true);
              try {
                // Directly invoke the save handler; it will display its own toast messages.
                await onSave();
              } catch (e) {
                console.error('❌ 평가 저장 중 예외 발생:', e);
              } finally {
                setIsSaving(false);
              }
            }}
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground px-2 sm:px-4"
          >
            <Save className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            <span className="hidden sm:inline">평가 저장</span>
            <span className="inline sm:hidden">저장</span>
          </Button>
        </div>

        <EvaluationSummary
          evaluationData={evaluationData}
          totalScore={totalScore}
          exactScore={exactScore}
          isAchieved={isAchieved}
        />
      </div>
    </div>
  );
};

export default EvaluationHeader;
