import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import MatrixGrid from '@/components/Evaluation/MatrixGrid';
import { useEvaluationMatrix } from '@/contexts/EvaluationMatrixContext';
import { MATRIX_SCORE_COLORS } from '@/lib/evaluationMatrix';
import { X, Star, Target, Users, Award, Clock, TrendingUp } from 'lucide-react';

interface EvaluationGuideProps {
  onClose: () => void;
}

const EvaluationGuide: React.FC<EvaluationGuideProps> = ({ onClose }) => {
  const { matrix } = useEvaluationMatrix();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 sm:p-4">
      <Card className="w-full max-w-5xl h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4 px-4 sm:px-6 flex-shrink-0">
          <div>
            <CardTitle className="text-xl sm:text-2xl flex items-center gap-2">
              <Star className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              평가 가이드
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              효과적인 성과 평가를 위한 상세 가이드라인
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        
        <CardContent className="flex-1 overflow-y-auto space-y-4 sm:space-y-6 px-4 sm:px-6">
          {/* 평가기준 */}
          <div className="space-y-3">
            <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              평가기준
            </h3>
            <div className="space-y-3">
              <div className="p-3 sm:p-4 bg-primary/5 border border-primary/20 rounded-lg">
                <h4 className="font-medium text-sm sm:text-base mb-3 text-primary">평가점수의 의미</h4>
                <div className="space-y-2">
                  <p className="text-xs sm:text-sm text-foreground font-medium">
                    평가점수는 성장레벨별 기대수준을 뜻합니다.
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    각 피평가자의 성장레벨에 따라 기대되는 역할과 성과 수준이 다르며, 이를 기준으로 평가점수가 산정됩니다.
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    성장레벨보다 평가점수가 같거나 높으면 해당 평가는 달성한 것이 됩니다.
                  </p>
                </div>
              </div>
              <div className="p-3 sm:p-4 bg-muted/30 border border-border rounded-lg">
                <h4 className="font-medium text-sm sm:text-base mb-3 text-foreground">수시 성과관리체계</h4>
                <div className="space-y-2">
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    • <strong className="text-foreground">지속적 모니터링:</strong> 과업 진행 상황을 실시간으로 추적하고 관리
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    • <strong className="text-foreground">정기적 피드백:</strong> 수시 성과보고를 통한 양방향 소통과 개선점 도출
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    • <strong className="text-foreground">적응적 목표 조정:</strong> 변화하는 환경에 맞춰 과업과 목표를 유연하게 조정
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    • <strong className="text-foreground">성장 중심 평가:</strong> 결과뿐만 아니라 과정과 학습을 중시하는 발전적 평가
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 평가 절차 */}
          <div className="space-y-3">
            <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              평가 절차
            </h3>
            <div className="grid gap-2 sm:gap-3">
              {/* 피평가자: 과업 등록 */}
              <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                <div className="w-6 h-6 sm:w-8 sm:h-8 bg-muted/50 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm sm:text-base font-bold text-foreground">1</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-medium text-sm sm:text-base mb-1">과업 등록</h4>
                  <p className="text-xs sm:text-sm text-muted-foreground">피평가자가 본인의 주요 과업과 가중치를 등록합니다. (필요시 내 과업에서 추가/수정)</p>
                </div>
              </div>
              {/* 평가자: 과업 검토 */}
              <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                <div className="w-6 h-6 sm:w-8 sm:h-8 bg-primary/15 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm sm:text-base font-bold text-primary">2</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-medium text-sm sm:text-base mb-1">과업 검토</h4>
                  <p className="text-xs sm:text-sm text-muted-foreground">피평가자의 과업 목록과 가중치를 확인합니다. 조정이 필요하면 「피평가자에게 돌려보내기」로 요청합니다.</p>
                </div>
              </div>
              {/* 평가자: 기여방식 평가 */}
              <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                <div className="w-6 h-6 sm:w-8 sm:h-8 bg-primary/15 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm sm:text-base font-bold text-primary">3</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-medium text-sm sm:text-base mb-1">기여방식 평가</h4>
                  <p className="text-xs sm:text-sm text-muted-foreground">각 과업에 대해 피평가자의 기여방식(총괄/리딩/실무/지원)을 선택합니다.</p>
                </div>
              </div>
              {/* 평가자: 기여범위 평가 */}
              <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                <div className="w-6 h-6 sm:w-8 sm:h-8 bg-primary/15 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm sm:text-base font-bold text-primary">4</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-medium text-sm sm:text-base mb-1">기여범위 평가</h4>
                  <p className="text-xs sm:text-sm text-muted-foreground">과업의 영향 범위(의존적/독립적/상호적/전략적)를 평가합니다.</p>
                </div>
              </div>
              {/* 평가자: 피드백 작성 */}
              <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                <div className="w-6 h-6 sm:w-8 sm:h-8 bg-primary/15 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm sm:text-base font-bold text-primary">5</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-medium text-sm sm:text-base mb-1">피드백 작성</h4>
                  <p className="text-xs sm:text-sm text-muted-foreground">구체적이고 건설적인 피드백을 작성하여 성장 방향을 제시합니다.</p>
                </div>
              </div>
              {/* 피평가자: 피드백 확인 */}
              <div className="flex items-start gap-3 p-3 border border-border rounded-lg">
                <div className="w-6 h-6 sm:w-8 sm:h-8 bg-muted/50 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-sm sm:text-base font-bold text-foreground">6</span>
                </div>
                <div className="flex-1">
                  <h4 className="font-medium text-sm sm:text-base mb-1">피드백 확인</h4>
                  <p className="text-xs sm:text-sm text-muted-foreground">피평가자는 피드백을 받고 올바른 방향으로 과업을 수행하며, 필요시 과업을 수정할 수 있습니다.</p>
                </div>
              </div>
            </div>
          </div>

          {/* 점수 매트릭스 */}
          <div className="space-y-3">
            <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
              <Award className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              점수 매트릭스
            </h3>
            <div className="overflow-x-auto">
              <MatrixGrid
                matrix={matrix}
                rowHeaderWidth={74}
                gap={4}
                style={{ minWidth: 430 }}
                renderMethodLabel={(method) => (
                  <div className="text-xs sm:text-sm font-medium text-foreground flex items-center h-10">
                    {method}
                  </div>
                )}
                renderScopeLabel={(scope) => (
                  <div className="text-2xs sm:text-xs text-center font-semibold text-muted-foreground pt-1">
                    {scope}
                  </div>
                )}
                renderCell={(_, __, ___, ____, score) => (
                  <div
                    className="h-10 rounded-lg flex items-center justify-center text-xs sm:text-sm font-bold"
                    style={{
                      background: `${MATRIX_SCORE_COLORS[score]}22`,
                      color: MATRIX_SCORE_COLORS[score],
                    }}
                  >
                    {score}점
                  </div>
                )}
              />
            </div>
          </div>

          {/* 기여방식 상세 설명 */}
          <div className="space-y-3">
            <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
              <Target className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              기여방식 상세
            </h3>
            <div className="grid gap-2 sm:gap-3 sm:grid-cols-2">
              <div className="p-3 border border-border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs">총괄</Badge>
                  <span className="text-xs sm:text-sm font-medium text-foreground">업무 전체를 책임지고 관리</span>
                </div>
                <p className="text-xs text-muted-foreground">프로젝트나 업무의 전체적인 방향을 설정하고 다른 구성원들을 이끌어 목표를 달성하는 역할</p>
              </div>
              <div className="p-3 border border-border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs">리딩</Badge>
                  <span className="text-xs sm:text-sm font-medium text-foreground">특정 영역을 주도적으로 담당</span>
                </div>
                <p className="text-xs text-muted-foreground">업무의 특정 부분에서 주도적인 역할을 하며, 해당 영역의 성과에 직접적인 책임을 지는 역할</p>
              </div>
              <div className="p-3 border border-border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs">실무</Badge>
                  <span className="text-xs sm:text-sm font-medium text-foreground">핵심 업무를 직접 수행</span>
                </div>
                <p className="text-xs text-muted-foreground">주어진 업무를 성실히 수행하며, 업무의 질적 완성도에 기여하는 역할</p>
              </div>
              <div className="p-3 border border-border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs">지원</Badge>
                  <span className="text-xs sm:text-sm font-medium text-foreground">다른 구성원을 보조하고 지원</span>
                </div>
                <p className="text-xs text-muted-foreground">주 담당자를 보조하여 업무가 원활히 진행될 수 있도록 돕는 역할</p>
              </div>
            </div>
          </div>

          {/* 기여범위 상세 설명 - 순서 변경 */}
          <div className="space-y-3">
            <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              기여범위 상세
            </h3>
            <div className="grid gap-2 sm:gap-3 sm:grid-cols-2">
              <div className="p-3 border border-border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs">의존적</Badge>
                  <span className="text-xs sm:text-sm font-medium text-foreground">지시받은 업무 수행</span>
                </div>
                <p className="text-xs text-muted-foreground">상급자나 동료의 지시나 가이드라인에 따라 업무를 수행하는 범위</p>
              </div>
              <div className="p-3 border border-border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs">독립적</Badge>
                  <span className="text-xs sm:text-sm font-medium text-foreground">자율적 업무 수행</span>
                </div>
                <p className="text-xs text-muted-foreground">개인의 판단과 책임 하에 독립적으로 업무를 기획하고 실행하는 범위</p>
              </div>
              <div className="p-3 border border-border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs">상호적</Badge>
                  <span className="text-xs sm:text-sm font-medium text-foreground">팀 단위 협업</span>
                </div>
                <p className="text-xs text-muted-foreground">팀 내 다른 구성원들과 긴밀히 협력하여 공동의 목표를 달성하는 범위</p>
              </div>
              <div className="p-3 border border-border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-xs">전략적</Badge>
                  <span className="text-xs sm:text-sm font-medium text-foreground">조직 전체에 영향</span>
                </div>
                <p className="text-xs text-muted-foreground">부서를 넘어 조직 전체의 방향성이나 성과에 영향을 미치는 범위</p>
              </div>
            </div>
          </div>
        </CardContent>

        <div className="border-t border-border bg-muted/20 flex-shrink-0 p-4 sm:p-6">
          <Button onClick={onClose} variant="outline" className="w-full sm:w-auto sm:ml-auto flex">
            확인
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default EvaluationGuide;
