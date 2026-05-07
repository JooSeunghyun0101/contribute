import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Target, CheckCircle, Clock, MessageSquare, TrendingUp, Settings, Award, Calendar as CalendarIcon, Star, Trophy, Users, ChevronDown, ChevronUp } from 'lucide-react';
import TaskGanttChart from '@/components/TaskGanttChart';
import EvaluationGuide from '@/components/Dashboard/EvaluationGuide';
import EvaluationSummary from '@/components/Evaluation/EvaluationSummary';
import { Task, FeedbackHistoryItem } from '@/types/evaluation';
import TaskListingComponent from '@/components/ui/task-listing-component';
import { useToast } from '@/hooks/use-toast';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';

export const EvaluateeDashboardDB: React.FC = () => {
  const { user } = useAuth();
  
  // 데이터베이스 연동 훅 사용
  const {
    evaluationData,
    isLoading,
    handleTaskUpdate,
    calculateTotalScore,
    isEvaluationComplete,
    isAchieved,
    reloadData
  } = useEvaluationDataDB(user?.employeeId || '');

  const [allFeedbacks, setAllFeedbacks] = useState<(FeedbackHistoryItem & { taskTitle: string })[]>([]);
  const [groupedFeedbacks, setGroupedFeedbacks] = useState<Record<string, (FeedbackHistoryItem & { taskTitle: string })[]>>({});
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
  const [showEvaluationGuide, setShowEvaluationGuide] = useState(false);
  const { toast } = useToast();
  const [selectedTab, setSelectedTab] = useState('tasks');
  const [lastFeedbackCheck, setLastFeedbackCheck] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('lastFeedbackCheck') || '';
    }
    return '';
  });

  // 피드백 데이터 업데이트 - 모든 과업 포함
  useEffect(() => {
    if (!evaluationData) return;

    // Collect all feedback history items with task titles
    const feedbackItems: (FeedbackHistoryItem & { taskTitle: string })[] = [];
    evaluationData.tasks.forEach(task => {
      if (task.feedbackHistory && task.feedbackHistory.length > 0) {
        task.feedbackHistory.forEach(feedback => {
          feedbackItems.push({
            ...feedback,
            taskTitle: task.title
          });
        });
      }
    });

    // Sort by date (most recent first)
    feedbackItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    setAllFeedbacks(feedbackItems);

    // Group feedbacks by task - 모든 과업 포함 (피드백이 없는 과업도 포함)
    const grouped: Record<string, (FeedbackHistoryItem & { taskTitle: string })[]> = {};
    
    // 모든 과업을 먼저 초기화 (빈 배열로)
    evaluationData.tasks.forEach(task => {
      grouped[task.title] = [];
    });
    
    // 피드백이 있는 과업들의 피드백 추가
    feedbackItems.forEach(feedback => {
      if (grouped[feedback.taskTitle]) {
        grouped[feedback.taskTitle].push(feedback);
      }
    });

    // Sort each group by date (most recent first)
    Object.keys(grouped).forEach(taskTitle => {
      grouped[taskTitle].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    });

    setGroupedFeedbacks(grouped);
  }, [evaluationData]);

  // 새 피드백 개수 계산
  const newFeedbackCount = allFeedbacks.filter(fb => 
    !lastFeedbackCheck || new Date(fb.date) > new Date(lastFeedbackCheck)
  ).length;

  // 피드백 탭 클릭 시 마지막 확인 시각 저장
  const handleTabChange = (tab: string) => {
    setSelectedTab(tab);
    if (tab === 'feedback') {
      const now = new Date().toISOString();
      setLastFeedbackCheck(now);
      localStorage.setItem('lastFeedbackCheck', now);
    }
  };

  // 인라인 과업 수정 핸들러
  const handleInlineTaskSave = async (updatedTask: Task) => {
    if (!evaluationData) return;
    
    // 이 과업을 포함한 전체 가중치 합계 계산
    const currentTotalWeight = evaluationData.tasks.reduce((sum, task) => {
      return task.id === updatedTask.id ? sum + updatedTask.weight : sum + task.weight;
    }, 0);

    if (currentTotalWeight !== 100) {
       toast({
        title: "가중치 합계 안내",
        description: `현재 가중치 합계가 ${currentTotalWeight}% 입니다. 최종적으로 100%를 맞춰야 합니다.`,
        variant: "destructive",
      });
    }

    try {
      // 해당 과업만 업데이트하기 위해 handleTaskUpdate API(또는 내부 훅) 사용
      // handleTaskUpdate는 상태를 낙관적으로 업데이트하고 DB 저장까지 처리하는 useEvaluationDataDB의 훅을 가정합니다.
      await handleTaskUpdate(updatedTask.id, updatedTask);
      
      toast({
        title: "과업 수정 완료",
        description: "과업 내용이 성공적으로 저장되었습니다.",
      });

      // 데이터 새로고침
      await reloadData();
    } catch (error) {
      console.error("인라인 과업 저장 실패:", error);
      toast({
        title: "과업 수정 실패",
        description: "과업을 저장하는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  // 과업별 피드백 접기/펼치기
  const toggleTaskFeedbacks = (taskTitle: string) => {
    setExpandedTasks(prev => ({
      ...prev,
      [taskTitle]: !prev[taskTitle]
    }));
  };

  if (!user) {
    return (
      <div className="p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">로그인이 필요합니다</h2>
          <p className="text-muted-foreground">피평가자 대시보드에 접근하려면 로그인해주세요.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">데이터 로딩 중...</h2>
          <p className="text-muted-foreground">평가 데이터를 불러오고 있습니다.</p>
        </div>
      </div>
    );
  }

  if (!evaluationData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] p-6 bg-muted rounded-lg">
        <h2 className="text-2xl font-bold mb-4 text-center">평가 데이터가 없습니다</h2>
        <p className="text-muted-foreground mb-6 text-center">
          평가 데이터를 찾을 수 없습니다. 새 평가를 시작하거나 데이터를 확인해 주세요.
        </p>
        <Button
          onClick={() => setShowEvaluationGuide(true)}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          새 평가 시작하기
        </Button>
      </div>
    );
  }

  const { exactScore, flooredScore } = calculateTotalScore();
  const totalWeight = evaluationData.tasks.reduce((sum, task) => sum + task.weight, 0);
  const taskStats = evaluationData.tasks.reduce(
    (stats, task) => {
      stats.total++;
      if (task.score !== undefined) stats.scored++;
      if (task.feedback) stats.withFeedback++;
      return stats;
    },
    { total: 0, scored: 0, withFeedback: 0 }
  );

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{user?.name || evaluationData.evaluateeName}님의 성과 대시보드</h1>
          <p className="text-muted-foreground mt-1">
            {(user?.department || evaluationData.evaluateeDepartment) && (
              <span>{user?.department || evaluationData.evaluateeDepartment} | </span>
            )}
            {(user?.position || evaluationData.evaluateePosition) && (
              <span>{user?.position || evaluationData.evaluateePosition} | </span>
            )}
            성장레벨 {user?.growthLevel && user.growthLevel > 0 ? user.growthLevel : (evaluationData.growthLevel && evaluationData.growthLevel > 0 ? evaluationData.growthLevel : 1)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowEvaluationGuide(true)}
            className="text-primary border-primary/40 hover:bg-primary/10"
          >
            평가 가이드
          </Button>
        </div>
      </div>

      {/* 성과 요약 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">총 점수</p>
                <p className="text-2xl font-bold text-primary">{exactScore.toFixed(1)}점</p>
                <p className="text-xs text-muted-foreground">목표: {evaluationData.growthLevel}점</p>
              </div>
              <Target className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">달성 여부</p>
                <p className={`text-2xl font-bold ${isAchieved() ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {isAchieved() ? '달성' : '미달성'}
                </p>
                <p className="text-xs text-muted-foreground">{flooredScore}점 기준</p>
              </div>
              {isAchieved() ? (
                <Trophy className="h-8 w-8 text-emerald-400" />
              ) : (
                <Clock className="h-8 w-8 text-amber-400" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">과업 현황</p>
                <p className="text-2xl font-bold text-primary">{taskStats.scored}/{taskStats.total}</p>
                <p className="text-xs text-muted-foreground">점수 입력 완료</p>
              </div>
              <CheckCircle className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">가중치 합계</p>
                <p className={`text-2xl font-bold ${totalWeight === 100 ? 'text-emerald-400' : 'text-destructive'}`}>
                  {totalWeight}%
                </p>
                <p className="text-xs text-muted-foreground">목표: 100%</p>
              </div>
              <Star className="h-8 w-8 text-amber-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 메인 컨텐츠 */}
      <Tabs value={selectedTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="tasks">과업 현황</TabsTrigger>
          <TabsTrigger value="feedback">
            피드백 이력
            {newFeedbackCount > 0 && (
              <Badge variant="destructive" className="ml-2 px-2 py-1">
                {newFeedbackCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="summary">성과 요약</TabsTrigger>
          <TabsTrigger value="gantt">일정 관리</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                등록된 과업 목록
              </CardTitle>
              <CardDescription>
                현재 등록된 과업들의 상세 정보와 평가 상태를 확인할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TaskListingComponent 
                tasks={evaluationData.tasks} 
                onSaveTask={handleInlineTaskSave}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">피드백 이력</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                평가자로부터 받은 피드백을 과업별로 확인하세요 (최신순)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {Object.keys(groupedFeedbacks).length === 0 ? (
                  <p className="text-center text-muted-foreground py-8 text-sm">과업 데이터가 없습니다.</p>
                ) : (
                  Object.entries(groupedFeedbacks).map(([taskTitle, feedbacks]) => {
                    const isExpanded = expandedTasks[taskTitle];
                    const displayedFeedbacks = isExpanded ? feedbacks : feedbacks.slice(0, 1);
                    
                    return (
                      <div key={taskTitle} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-sm sm:text-base text-foreground">{taskTitle}</h4>
                          {feedbacks.length > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {feedbacks.length}개 피드백
                            </Badge>
                          )}
                        </div>
                        
                        {feedbacks.length === 0 ? (
                          // 피드백이 없는 경우
                          <div className="bg-muted/30 border border-border rounded-md p-3">
                            <div className="flex items-center gap-2">
                              <MessageSquare className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">아직 받은 피드백이 없습니다.</span>
                            </div>
                          </div>
                        ) : (
                          // 피드백이 있는 경우
                          <>
                            <div className="space-y-3">
                              {displayedFeedbacks.map((feedback, index) => (
                                <div key={feedback.id} className="bg-primary/5 border border-primary/20 rounded-md p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs sm:text-sm font-medium">평가자: {feedback.evaluatorName}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(feedback.date).toLocaleDateString('ko-KR', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      })}
                                    </span>
                                  </div>
                                  <p className="text-xs sm:text-sm text-foreground">
                                    {feedback.content}
                                  </p>
                                </div>
                              ))}
                            </div>
                            
                            {feedbacks.length > 1 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleTaskFeedbacks(taskTitle)}
                                className="w-full text-xs sm:text-sm mt-2"
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronUp className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                                    피드백 접기
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
                                    {feedbacks.length - 1}개 피드백 더보기
                                  </>
                                )}
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="space-y-6">
          <EvaluationSummary
            evaluationData={evaluationData}
            totalScore={flooredScore}
            exactScore={exactScore}
            isAchieved={isAchieved()}
          />
        </TabsContent>

        <TabsContent value="gantt" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="h-5 w-5" />
                과업 일정 관리
              </CardTitle>
              <CardDescription>
                등록된 과업들의 일정을 간트 차트로 확인할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TaskGanttChart tasks={evaluationData.tasks} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 평가 가이드 모달 */}
      {showEvaluationGuide && (
        <EvaluationGuide onClose={() => setShowEvaluationGuide(false)} />
      )}
    </div>
  );
}; 