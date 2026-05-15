import React, { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { User, Building2, CheckCircle, AlertCircle, TrendingUp } from 'lucide-react';
import { EvaluationData } from '@/types/evaluation';
import { useAuth } from '@/contexts/AuthContext';

interface EvaluationSummaryProps {
  evaluationData: EvaluationData;
  totalScore: number;
  exactScore: number;
  isAchieved: boolean;
}

const EvaluationSummary: React.FC<EvaluationSummaryProps> = ({
  evaluationData,
  totalScore,
  exactScore,
  isAchieved
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const { user } = useAuth();

  const handleAchievementHover = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleAchievementLeave = useCallback(() => {
    setIsHovered(false);
  }, []);


  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <Card className="col-span-2 lg:col-span-1">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-muted rounded-full flex items-center justify-center">
              <User className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm sm:text-lg font-semibold truncate">
                {user?.name ?? evaluationData.evaluateeName} {user?.position ?? evaluationData.evaluateePosition}
              </h2>
              <div className="flex items-center gap-1 sm:gap-2 text-muted-foreground text-xs sm:text-sm mt-1">
                <Building2 className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="truncate">{user?.department ?? evaluationData.evaluateeDepartment}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-primary/15 rounded-full flex items-center justify-center">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
            </div>
            <div className="text-center flex-1">
              <p className="text-xs sm:text-sm text-muted-foreground">성장 레벨</p>
              <p className="text-lg sm:text-2xl font-bold text-primary">Lv. {user?.growthLevel ?? (evaluationData.growthLevel && evaluationData.growthLevel > 0 ? evaluationData.growthLevel : 1)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="text-center">
            <p className="text-xs sm:text-sm text-muted-foreground">총 평가 점수</p>
            <p className="text-lg sm:text-2xl font-bold text-primary">
              {totalScore}점
              {exactScore !== totalScore && (
                <span className="text-sm text-muted-foreground ml-1">
                  ({exactScore.toFixed(2)})
                </span>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card 
        className={`group hover:shadow-lg hover:scale-105 transition-all duration-300 relative overflow-hidden cursor-pointer ${
          isAchieved
            ? 'hover:border-emerald-500/30 hover:bg-emerald-500/10'
            : 'hover:border-destructive/30 hover:bg-destructive/10'
        }`}
        onMouseEnter={handleAchievementHover}
        onMouseLeave={handleAchievementLeave}
        data-confetti-trigger={isAchieved ? 'true' : undefined}
        data-not-achieved={!isAchieved ? 'true' : undefined}
        title={isAchieved ? '클릭하여 축하 폭죽 효과를 확인하세요!' : undefined}
      >
        <CardContent className="p-3 sm:p-4 relative">
          <div className="text-center">
            <p className="text-xs sm:text-sm text-muted-foreground">달성 여부</p>
            <div className="flex items-center justify-center gap-1 sm:gap-2 mt-1">
              {isAchieved ? (
                <>
                  <div className="relative inline-block">
                    <span className={`text-2xl sm:text-3xl transition-all duration-300 ${
                      isHovered ? 'scale-125' : 'group-hover:scale-125'
                    }`}>
                      🎉
                    </span>
                  </div>
                  <span className={`text-lg sm:text-2xl font-bold transition-colors duration-300 ${
                    isHovered ? 'text-emerald-300' : 'text-emerald-400 group-hover:text-emerald-300'
                  }`}>달성</span>
                </>
              ) : (
                <>
                  <div className="relative inline-block">
                    <span className={`text-2xl sm:text-3xl transition-all duration-300 ${
                      isHovered ? 'scale-125' : 'group-hover:scale-125'
                    }`}>
                      😢
                    </span>
                  </div>
                  <span className={`text-lg sm:text-2xl font-bold transition-colors duration-300 ${
                    isHovered ? 'text-destructive/80' : 'text-destructive group-hover:text-destructive/80'
                  }`}>미달성</span>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default EvaluationSummary;
