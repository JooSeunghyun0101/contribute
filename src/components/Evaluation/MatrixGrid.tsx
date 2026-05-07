import type { CSSProperties, ReactNode } from 'react';
import type { EvaluationMatrixScores } from '@/lib/evaluationMatrix';
import { MATRIX_METHODS, MATRIX_SCOPES, MATRIX_SCORES } from '@/lib/evaluationMatrix';

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
      fontSize: 11,
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
      fontSize: 11,
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
        <div key={`method-${method}`} style={{ display: 'flex', alignItems: 'stretch' }}>
          {renderMethodLabel(method, methodIndex)}
        </div>,
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
        <div key={`scope-${scope}`}>{renderScopeLabel(scope, scopeIndex)}</div>
      ))}
    </div>
  );
};

export default MatrixGrid;
