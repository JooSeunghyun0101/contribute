
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScoreExpectationContent } from '@/components/Evaluation/ExpectationTooltipContent';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { getContributionTooltip } from '@/utils/evaluationUtils';
import {
  getMatrixMethodIndex,
  getMatrixScopeIndex,
  MATRIX_METHODS,
  MATRIX_SCOPES,
  MATRIX_SCORES,
} from '@/lib/evaluationMatrix';

interface ScoringChartProps {
  selectedScope?: string;
  selectedMethod?: string;
  title?: string;
  size?: 'small' | 'medium' | 'large';
  onMethodClick?: (method: string) => void;
  onScopeClick?: (scope: string) => void;
  isReadOnly?: boolean;
  growthLevel?: number | null;
}

const ScoringChart: React.FC<ScoringChartProps> = ({
  selectedScope,
  selectedMethod,
  title = "스코어링 매트릭스",
  size = 'medium',
  onMethodClick,
  onScopeClick,
  isReadOnly = false,
  growthLevel,
}) => {
  const { matrix } = useEvaluationMatrix();
  // 기여 방식 (Y축)
  const methods = MATRIX_METHODS;
  
  // 기여 범위 (X축)  
  const scopes = MATRIX_SCOPES;
  const selectedMethodIndex = getMatrixMethodIndex(selectedMethod);
  const selectedScopeIndex = getMatrixScopeIndex(selectedScope);

  const getCellSize = () => {
    switch (size) {
      case 'small':
        return 'w-8 h-8 text-xs';
      case 'large':
        return 'w-20 h-20 text-lg';
      default:
        return 'w-14 h-14 text-sm';
    }
  };

  const getHeaderSize = () => {
    switch (size) {
      case 'small':
        return 'w-8 h-8 text-xs';
      case 'large':
        return 'w-20 h-20 text-base';
      default:
        return 'w-14 h-14 text-xs';
    }
  };

  const isMethodSelected = (methodIndex: number) => {
    return methodIndex === selectedMethodIndex;
  };

  const isScopeSelected = (scopeIndex: number) => {
    return scopeIndex === selectedScopeIndex;
  };

  const isCellHighlighted = (methodIndex: number, scopeIndex: number) => {
    return methodIndex === selectedMethodIndex && scopeIndex === selectedScopeIndex;
  };

  const isNoContributionSelected = () => {
    return selectedMethod === '기여없음' && selectedScope === '기여없음';
  };

  const handleMethodClick = (methodIndex: number) => {
    if (isReadOnly) return;
    if (onMethodClick) {
      const method = methods[methodIndex];
      onMethodClick(method);
    }
  };

  const handleScopeClick = (scopeIndex: number) => {
    if (isReadOnly) return;
    if (onScopeClick) {
      const scope = scopes[scopeIndex];
      onScopeClick(scope);
    }
  };

  const handleNoContributionClick = () => {
    if (isReadOnly) return;
    if (onMethodClick && onScopeClick) {
      onMethodClick('기여없음');
      onScopeClick('기여없음');
    }
  };

  return (
    <Card className="w-fit border-primary/30 max-w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-center text-primary">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        <div className="flex flex-col gap-1">
          {/* Matrix rows with method labels */}
          {methods.map((method, methodIndex) => (
            <div key={method} className="flex gap-1">
              {/* Method label */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={`
                    ${getHeaderSize()} flex items-center justify-center font-bold text-xs rounded border transition-all text-center leading-tight
                    ${isReadOnly ? 'cursor-default' : 'cursor-pointer'}
                    ${isMethodSelected(methodIndex) 
                      ? `bg-primary text-primary-foreground border-primary/80 border-2 shadow-lg ${isReadOnly ? '' : 'transform scale-105'}`
                      : `bg-primary/20 text-foreground ${isReadOnly ? '' : 'hover:bg-primary/30'}`
                    }
                  `}
                  onClick={() => handleMethodClick(methodIndex)}
                  >
                    {method}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs p-3 bg-card border-border shadow-lg">
                  <p className="text-sm text-foreground leading-relaxed">
                    {getContributionTooltip('method', method)}
                  </p>
                </TooltipContent>
              </Tooltip>
              
              {/* Score cells */}
              {scopes.map((scope, scopeIndex) => {
                const score = matrix[methodIndex]?.[scopeIndex] ?? MATRIX_SCORES[methodIndex][scopeIndex];
                const highlighted = isCellHighlighted(methodIndex, scopeIndex);
                
                return (
                  <Tooltip key={`${method}-${scope}`}>
                    <TooltipTrigger asChild>
                      <div
                        className={`
                          ${getCellSize()} 
                          flex items-center justify-center 
                          font-bold rounded border-2 transition-all cursor-help
                          ${highlighted 
                            ? `bg-emerald-500/20 text-emerald-400 border-emerald-500 shadow-lg ring-2 ring-emerald-500/30 ${isReadOnly ? '' : 'scale-110'}`
                            : 'bg-muted/50 text-muted-foreground border-border'
                          }
                        `}
                      >
                        {score}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="p-3">
                      <ScoreExpectationContent
                        score={score}
                        method={method}
                        scope={scope}
                        growthLevel={growthLevel}
                      />
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}

          {/* Header row at bottom */}
          <div className="flex gap-1 mt-1">
            <div 
              className={`
                ${getHeaderSize()} flex items-center justify-center font-bold text-xs rounded border transition-all text-center leading-tight
                ${isReadOnly ? 'cursor-default' : 'cursor-pointer'}
                ${isNoContributionSelected() 
                  ? `bg-destructive text-destructive-foreground border-destructive/80 border-2 shadow-lg ${isReadOnly ? '' : 'transform scale-105'}`
                  : `bg-destructive/20 text-foreground ${isReadOnly ? '' : 'hover:bg-destructive/30'}`
                }
              `}
              onClick={handleNoContributionClick}
            >
              기여없음
            </div>
            {scopes.map((scope, index) => (
              <Tooltip key={scope}>
                <TooltipTrigger asChild>
                  <div 
                    className={`
                      ${getHeaderSize()} flex items-center justify-center font-bold text-xs rounded border text-center leading-tight transition-all
                      ${isReadOnly ? 'cursor-default' : 'cursor-pointer'}
                      ${isScopeSelected(index) 
                        ? `bg-amber-500 text-white border-amber-600/80 border-2 shadow-lg ${isReadOnly ? '' : 'transform scale-105'}`
                        : `bg-amber-500/20 text-foreground ${isReadOnly ? '' : 'hover:bg-amber-500/30'}`
                      }
                    `}
                    onClick={() => handleScopeClick(index)}
                  >
                    {scope}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs p-3 bg-card border-border shadow-lg">
                  <p className="text-sm text-foreground leading-relaxed">
                    {getContributionTooltip('scope', scope)}
                  </p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ScoringChart;
