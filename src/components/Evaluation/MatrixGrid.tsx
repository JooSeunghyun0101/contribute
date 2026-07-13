import type { CSSProperties, ReactNode } from 'react';
import type { EvaluationMatrixScores } from '@/lib/evaluationMatrix';
import { MATRIX_METHODS, MATRIX_SCOPES, MATRIX_SCORES } from '@/lib/evaluationMatrix';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MethodScopeGuideContent } from '@/components/Evaluation/ExpectationTooltipContent';

type MatrixGridProps = {
  className?: string;
  style?: CSSProperties;
  matrix?: EvaluationMatrixScores | readonly (readonly number[])[];
  rowHeaderWidth?: number | string;
  gap?: number;
  renderCell: (
    method: string,
    scope: string,
    methodIndex: number,
    scopeIndex: number,
    score: number,
  ) => ReactNode;
  renderMethodLabel?: (method: string, methodIndex: number) => ReactNode;
  renderScopeLabel?: (scope: string, scopeIndex: number) => ReactNode;
};

const defaultMethodLabel = (method: string) => (
  <div
    style={{
      fontSize: 'var(--fs-xs)',
      fontWeight: 700,
      color: 'var(--fg-muted)',
      display: 'flex',
      alignItems: 'center',
      width: '100%',
    }}
  >
    {method}
  </div>
);

const defaultScopeLabel = (scope: string) => (
  <div
    style={{
      textAlign: 'center',
      fontSize: 'var(--fs-xs)',
      fontWeight: 700,
      color: 'var(--fg-muted)',
      paddingTop: 4,
    }}
  >
    {scope}
  </div>
);

export const MatrixGrid = ({
  className,
  style,
  matrix = MATRIX_SCORES,
  rowHeaderWidth = 64,
  gap = 6,
  renderCell,
  renderMethodLabel = defaultMethodLabel,
  renderScopeLabel = defaultScopeLabel,
}: MatrixGridProps) => {
  const rowHeader = typeof rowHeaderWidth === 'number' ? `${rowHeaderWidth}px` : rowHeaderWidth;

  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `${rowHeader} repeat(${MATRIX_SCOPES.length}, minmax(0, 1fr))`,
        gap,
        alignItems: 'stretch',
        ...style,
      }}
    >
      {MATRIX_METHODS.flatMap((method, methodIndex) => [
        <Tooltip key={`method-${method}`}>
          <TooltipTrigger asChild>
            {/* 점선 밑줄 = hover 설명(툴팁) 가능 어포던스 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'stretch',
                cursor: 'help',
                textDecorationLine: 'underline',
                textDecorationStyle: 'dotted',
                textDecorationColor: 'var(--fg-subtle)',
                textUnderlineOffset: '3px',
              }}
            >
              {renderMethodLabel(method, methodIndex)}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            <MethodScopeGuideContent kind="method" term={method} />
          </TooltipContent>
        </Tooltip>,
        ...MATRIX_SCOPES.map((scope, scopeIndex) => (
          <div key={`cell-${method}-${scope}`} style={{ minWidth: 0 }}>
            {renderCell(
              method,
              scope,
              methodIndex,
              scopeIndex,
              matrix[methodIndex]?.[scopeIndex] ?? MATRIX_SCORES[methodIndex][scopeIndex],
            )}
          </div>
        )),
      ])}
      <div />
      {MATRIX_SCOPES.map((scope, scopeIndex) => (
        <Tooltip key={`scope-${scope}`}>
          <TooltipTrigger asChild>
            <div
              style={{
                cursor: 'help',
                textDecorationLine: 'underline',
                textDecorationStyle: 'dotted',
                textDecorationColor: 'var(--fg-subtle)',
                textUnderlineOffset: '3px',
              }}
            >
              {renderScopeLabel(scope, scopeIndex)}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <MethodScopeGuideContent kind="scope" term={scope} />
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
};

export default MatrixGrid;
