
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import MatrixGrid from '@/components/Evaluation/MatrixGrid';
import { useToast } from '@/hooks/use-toast';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { useExpectations } from '@/contexts/ExpectationContext';
import { cloneDefaultMatrix, MATRIX_METHODS, MATRIX_SCOPES } from '@/lib/evaluationMatrix';
import { X, Save } from 'lucide-react';

const GuideItem = ({ term, desc }: { term: string; desc: string }) => (
  <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
    <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 800 }}>{term}</div>
    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-muted)', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
  </div>
);

interface EvaluationMatrixProps {
  onClose?: () => void;
}

export const EvaluationMatrix: React.FC<EvaluationMatrixProps> = ({ onClose }) => {
  const { toast } = useToast();
  const { matrix: activeMatrix, isLoading, previewMatrix, saveMatrix } = useEvaluationMatrix();
  const { matrixGuide } = useExpectations();
  const [matrix, setMatrix] = useState<number[][]>(() => activeMatrix.map((row) => [...row]));

  useEffect(() => {
    setMatrix(activeMatrix.map((row) => [...row]));
  }, [activeMatrix]);

  const handleMatrixChange = (methodIndex: number, scopeIndex: number, value: string) => {
    const numValue = Number.parseInt(value, 10);
    if (Number.isNaN(numValue) || numValue < 1 || numValue > 4) return;
    
    const newMatrix = matrix.map((row, i) => 
      i === methodIndex 
        ? row.map((cell, j) => j === scopeIndex ? numValue : cell)
        : row
    );
    setMatrix(newMatrix);
    previewMatrix(newMatrix);
  };

  const handleSave = async () => {
    try {
      await saveMatrix(matrix);
      
      toast({
        title: "매트릭스 저장 완료",
        description: "평가 매트릭스가 모든 매트릭스 화면과 점수 계산에 즉시 반영됩니다.",
      });
      
    } catch (error) {
      console.error('❌ 매트릭스 저장 실패:', error);
      toast({
        title: "저장 실패",
        description: "평가 매트릭스 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleReset = () => {
    const defaultMatrix = cloneDefaultMatrix();
    setMatrix(defaultMatrix);
    previewMatrix(defaultMatrix);
    toast({
      title: "매트릭스 초기화",
      description: "기본 매트릭스로 초기화되었습니다.",
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">평가 매트릭스 설정</h2>
            <p className="text-muted-foreground">데이터를 로딩 중입니다...</p>
          </div>
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              <X className="mr-2 h-4 w-4" />
              닫기
            </Button>
          )}
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="text-center">로딩 중...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">평가 매트릭스 설정</h2>
          <p className="text-muted-foreground">기여 방식과 범위에 따른 점수 매트릭스를 설정하세요</p>
        </div>
        {onClose && (
          <Button variant="outline" onClick={onClose}>
            <X className="mr-2 h-4 w-4" />
            닫기
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>점수 매트릭스</CardTitle>
          <CardDescription>
            각 기여 방식과 범위의 조합에 따른 점수를 설정합니다 (1-4점)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <MatrixGrid
              matrix={matrix}
              rowHeaderWidth={88}
              gap={8}
              style={{ minWidth: 520 }}
              renderMethodLabel={(method) => (
                <div
                  style={{
                    height: 46,
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: 'var(--fs-body)',
                    fontWeight: 700,
                    color: 'var(--fg)',
                  }}
                >
                  {method}
                </div>
              )}
              renderScopeLabel={(scope) => (
                <div
                  style={{
                    textAlign: 'center',
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 700,
                    color: 'var(--fg-muted)',
                    paddingTop: 4,
                  }}
                >
                  {scope}
                </div>
              )}
              renderCell={(_, __, methodIndex, scopeIndex) => (
                <div
                  style={{
                    height: 46,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--bg-card)',
                    padding: 4,
                  }}
                >
                  <Input
                    type="number"
                    min="1"
                    max="4"
                    value={matrix[methodIndex]?.[scopeIndex] ?? 0}
                    onChange={(e) => handleMatrixChange(methodIndex, scopeIndex, e.target.value)}
                    className="w-full h-full text-center"
                  />
                </div>
              )}
            />
          </div>

          <div className="flex justify-between mt-6">
            <Button variant="outline" onClick={handleReset}>
              기본값으로 초기화
            </Button>
            <Button onClick={handleSave}>
              <Save className="mr-2 h-4 w-4" />
              저장
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>매트릭스 가이드</CardTitle>
          <CardDescription>기여 방식(행)과 범위(열)의 정의입니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <div>
              <h4 className="font-medium mb-2" style={{ color: 'var(--ok-orange)' }}>
                기여 방식
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {MATRIX_METHODS.map((m) => (
                  <GuideItem key={m} term={m} desc={matrixGuide.methods[m] ?? ''} />
                ))}
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2" style={{ color: 'var(--ok-orange)' }}>
                기여 범위
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {MATRIX_SCOPES.map((s) => (
                  <GuideItem key={s} term={s} desc={matrixGuide.scopes[s] ?? ''} />
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
