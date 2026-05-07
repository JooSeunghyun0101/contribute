import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, CheckCircle, Clock, MessageSquare, Star, TrendingUp } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import MiniGanttChart from '@/components/MiniGanttChart';
import { employeeService, evaluationService, taskService } from '@/lib/services';
import { EvaluationData } from '@/types/evaluation';

interface EvaluateeInfo {
  id: string;
  name: string;
  position: string;
  department: string;
  progress: number;
  growthLevel: number;
  lastModified: string;
  status: 'in-progress' | 'completed';
  totalTasks: number;
  completedTasks: number;
  totalScore: number;
  isAchieved: boolean;
}

export const EvaluatorDashboardDB: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [evaluatees, setEvaluatees] = useState<EvaluateeInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('overview');

  // 피평가자 데이터 로드
  useEffect(() => {
    const loadEvaluatees = async () => {
      if (!user?.employeeId) return;

      try {
        setIsLoading(true);

                 // 내가 평가하는 직원들 조회
         const employees = await employeeService.getEvaluateesByEvaluator(user.employeeId);

        const evaluateeList: EvaluateeInfo[] = [];

        for (const employee of employees) {
          // 각 직원의 평가 데이터 조회
          const evaluation = await evaluationService.getEvaluationByEmployeeId(employee.employee_id);
          if (!evaluation) continue;

          // 해당 평가의 과업들 조회
          let tasks = await taskService.getTasksByEvaluationId(evaluation.id);
          tasks = tasks.filter((t: any) => !t.deleted_at);

          // 통계 계산
          const totalTasks = tasks.length;
          const completedTasks = tasks.filter(task => task.score !== null).length;
          const totalWeight = tasks.reduce((sum, task) => sum + task.weight, 0);
          const totalScore = tasks.reduce((sum, task) => {
            if (task.score !== null) {
              return sum + (task.score * task.weight / 100);
            }
            return sum;
          }, 0);

          const isAchieved = Math.floor(totalScore) >= employee.growth_level;
          const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

          evaluateeList.push({
            id: employee.employee_id,
            name: employee.name,
            position: employee.position,
            department: employee.department,
            progress: progress,
            growthLevel: employee.growth_level,
            lastModified: evaluation.updated_at || evaluation.created_at,
            status: progress === 100 ? 'completed' : 'in-progress',
            totalTasks,
            completedTasks,
            totalScore,
            isAchieved
          });
        }

        setEvaluatees(evaluateeList);
      } catch (error) {
        console.error('❌ 평가자 대시보드 데이터 로딩 실패:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadEvaluatees();
  }, [user]);

  // 평가 페이지로 이동
  const handleEvaluate = (evaluateeId: string) => {
    navigate(`/evaluation/${evaluateeId}`);
  };

  // 통계 계산
  const totalEvaluatees = evaluatees.length;
  const completedEvaluations = evaluatees.filter(e => e.status === 'completed').length;
  const inProgressEvaluations = evaluatees.filter(e => e.status === 'in-progress').length;
  const averageProgress = evaluatees.length > 0 
    ? evaluatees.reduce((sum, e) => sum + e.progress, 0) / evaluatees.length 
    : 0;
  const achievedCount = evaluatees.filter(e => e.isAchieved).length;

  if (!user) {
    return (
      <div className="p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4 text-foreground">로그인이 필요합니다</h2>
          <p className="text-muted-foreground">평가자 대시보드에 접근하려면 로그인해주세요.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4 text-foreground">데이터 로딩 중...</h2>
          <p className="text-muted-foreground">평가 데이터를 불러오고 있습니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{user.name}님의 평가자 대시보드</h1>
          <p className="text-muted-foreground mt-1">
            {user.department} | {user.position} | 담당 직원: {totalEvaluatees}명
          </p>
        </div>
      </div>

      {/* 통계 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">총 담당 직원</p>
                <p className="text-2xl font-bold text-primary">{totalEvaluatees}명</p>
                <p className="text-xs text-muted-foreground">평가 대상자</p>
              </div>
              <Users className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">완료된 평가</p>
                <p className="text-2xl font-bold text-emerald-400">{completedEvaluations}명</p>
                <p className="text-xs text-muted-foreground">평가 완료</p>
              </div>
              <CheckCircle className="h-8 w-8 text-emerald-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">진행 중인 평가</p>
                <p className="text-2xl font-bold text-amber-400">{inProgressEvaluations}명</p>
                <p className="text-xs text-muted-foreground">평가 진행 중</p>
              </div>
              <Clock className="h-8 w-8 text-amber-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">목표 달성자</p>
                <p className="text-2xl font-bold text-primary">{achievedCount}명</p>
                <p className="text-xs text-muted-foreground">성장레벨 달성</p>
              </div>
              <Star className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 메인 컨텐츠 */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="overview">평가 현황</TabsTrigger>
          <TabsTrigger value="progress">진행률 상세</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                담당 직원 목록
              </CardTitle>
              <CardDescription>
                각 직원의 평가 상태와 진행률을 확인하고 평가를 진행할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {evaluatees.map((evaluatee) => (
                  <Card key={evaluatee.id} className="border-l-4 border-l-primary">
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-semibold text-lg text-foreground">{evaluatee.name}</h3>
                            <Badge variant="outline" className="border-border text-muted-foreground">
                              {evaluatee.position}
                            </Badge>
                            <Badge variant={evaluatee.isAchieved ? "default" : "secondary"}>
                              성장레벨 {evaluatee.growthLevel && evaluatee.growthLevel > 0 ? evaluatee.growthLevel : 1} {evaluatee.isAchieved ? '달성' : '미달성'}
                            </Badge>
                          </div>
                          <p className="text-muted-foreground text-sm">{evaluatee.department}</p>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <Badge
                            variant={evaluatee.status === 'completed' ? "default" : "secondary"}
                            className={evaluatee.status === 'completed' ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-amber-500/15 text-amber-400 border-amber-500/30"}
                          >
                            {evaluatee.status === 'completed' ? '평가 완료' : '평가 진행 중'}
                          </Badge>
                          <Button
                            onClick={() => handleEvaluate(evaluatee.id)}
                            size="sm"
                            className="bg-primary hover:bg-primary/90 text-primary-foreground"
                          >
                            평가하기
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                        <div>
                          <span className="text-muted-foreground">총 과업:</span>
                          <span className="ml-2 font-medium text-foreground">{evaluatee.totalTasks}개</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">완료 과업:</span>
                          <span className="ml-2 font-medium text-foreground">{evaluatee.completedTasks}개</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">총 점수:</span>
                          <span className="ml-2 font-medium text-foreground">{evaluatee.totalScore.toFixed(1)}점</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">수정일:</span>
                          <span className="ml-2 font-medium text-foreground">
                            {new Date(evaluatee.lastModified).toLocaleDateString('ko-KR')}
                          </span>
                        </div>
                      </div>

                      {/* 진행률 바 */}
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all duration-300"
                          style={{ width: `${evaluatee.progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        진행률: {evaluatee.progress.toFixed(1)}%
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="progress" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                진행률 상세 분석
              </CardTitle>
              <CardDescription>
                각 직원별 평가 진행 상황을 상세히 분석합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* 전체 진행률 통계 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-muted/30 rounded-lg border border-border">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">평균 진행률</p>
                    <p className="text-2xl font-bold text-primary">{averageProgress.toFixed(1)}%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">평가 완료율</p>
                    <p className="text-2xl font-bold text-emerald-400">
                      {totalEvaluatees > 0 ? ((completedEvaluations / totalEvaluatees) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">목표 달성률</p>
                    <p className="text-2xl font-bold text-amber-400">
                      {totalEvaluatees > 0 ? ((achievedCount / totalEvaluatees) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                </div>

                {/* 개별 진행률 */}
                <div className="space-y-4">
                  {evaluatees.map((evaluatee) => (
                    <div key={evaluatee.id} className="p-4 border border-border rounded-lg">
                      <div className="flex justify-between items-center mb-3">
                        <div>
                          <h4 className="font-medium text-foreground">{evaluatee.name}</h4>
                          <p className="text-sm text-muted-foreground">{evaluatee.department} | {evaluatee.position}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-lg text-foreground">{evaluatee.progress.toFixed(1)}%</p>
                          <p className="text-sm text-muted-foreground">{evaluatee.completedTasks}/{evaluatee.totalTasks} 완료</p>
                        </div>
                      </div>

                      <div className="w-full bg-muted rounded-full h-3 mb-2">
                        <div
                          className="bg-primary h-3 rounded-full transition-all duration-300"
                          style={{ width: `${evaluatee.progress}%` }}
                        />
                      </div>

                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>총 점수: {evaluatee.totalScore.toFixed(1)}점</span>
                        <span className={evaluatee.isAchieved ? "text-emerald-400" : "text-destructive"}>
                          목표: {evaluatee.growthLevel && evaluatee.growthLevel > 0 ? evaluatee.growthLevel : 1}점 {evaluatee.isAchieved ? '달성' : '미달성'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}; 