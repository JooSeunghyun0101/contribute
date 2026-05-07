
import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Target, CheckCircle, Clock, MessageSquare, Settings, Calendar as CalendarIcon, Star, ChevronUp, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import TaskGanttChart from '@/components/TaskGanttChart';
import TaskListingComponent from '@/components/ui/task-listing-component';
import { Task, FeedbackHistoryItem, EvaluationData } from '@/types/evaluation';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import EvaluationGuide from '@/components/Dashboard/EvaluationGuide';
import { cn } from '@/lib/utils';
import { useScroll } from '@/components/ui/use-scroll';

export const EvaluateeDashboard: React.FC = () => {
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
  // containerRef 자리 표시 — e.target 방식이므로 current 값은 필요 없음
  const containerRef = React.useRef<HTMLElement | null>(null);
  const scrolled = useScroll(10, containerRef);

  const [showEvaluationGuide, setShowEvaluationGuide] = useState(false);
  const [selectedTab, setSelectedTab] = useState('tasks');
  const [allFeedbacksBadgeRead, setAllFeedbacksBadgeRead] = useState(false);
  const [lastFeedbackCheck, setLastFeedbackCheck] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('lastFeedbackCheck') || '';
    }
    return '';
  });

  // 새 피드백 개수 계산
  const newFeedbackCount = allFeedbacks.filter(fb => !lastFeedbackCheck || new Date(fb.date) > new Date(lastFeedbackCheck)).length;

  // 피드백 탭 클릭 시 마지막 확인 시각 저장
  const handleTabChange = (tab: string) => {
    setSelectedTab(tab);
    if (tab === 'feedback') {
      setAllFeedbacksBadgeRead(true);
      const now = new Date().toISOString();
      setLastFeedbackCheck(now);
      localStorage.setItem('lastFeedbackCheck', now);
    }
  };

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

  const { toast } = useToast();

  const handleInlineTaskSave = async (updatedTask: Task) => {
    if (!evaluationData) return;

    const totalWeight = evaluationData.tasks.reduce((sum, task) => {
      if (task.id === updatedTask.id) {
        return sum + (updatedTask.weight || 0);
      }
      return sum + (task.weight || 0);
    }, 0);

    if (totalWeight !== 100) {
      toast({
        title: "가중치 확인 필요",
        description: `전체 과업 가중치 합이 100%가 아닙니다 (현재 ${totalWeight}%). (저장은 완료됨)`,
        variant: "destructive",
      });
    }

    try {
      await handleTaskUpdate(updatedTask.id, updatedTask);
      toast({
        title: "저장 완료",
        description: "과업 내용이 성공적으로 수정되었습니다.",
      });
    } catch (error) {
      console.error("Task update error:", error);
      toast({
        title: "저장 실패",
        description: "과업 업데이트 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const toggleTaskFeedbacks = (taskTitle: string) => {
    setExpandedTasks(prev => ({
      ...prev,
      [taskTitle]: !prev[taskTitle]
    }));
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  const evalData = evaluationData ?? {
    evaluateeId: '',
    evaluateeName: '',
    evaluateeDepartment: '',
    evaluateePosition: '',
    growthLevel: 0,
    evaluationStatus: 'in-progress',
    lastModified: '',
    tasks: [] as any[]
  };

  const totalTasks = evalData.tasks.length;
  const completedTasks = evalData.tasks.filter(task => task.score !== undefined).length;
  const inProgressTasks = totalTasks - completedTasks;

  // Calculate performance metrics for summary
  const { exactScore, flooredScore } = calculateTotalScore();

  const myStats = [
    {
      label: { full: '전체 과업', mobile: '과업' },
      value: `${evalData.tasks.length}개`,
      icon: Target,
      color: 'text-primary',
    },
    {
      label: { full: '완료된 평가', mobile: '완료' },
      value: `${completedTasks}개`,
      icon: CheckCircle,
      color: 'text-emerald-400',
    },
    {
      label: { full: '진행 중인 평가', mobile: '진행중' },
      value: `${inProgressTasks}개`,
      icon: Clock,
      color: 'text-amber-400',
    },
    {
      label: { full: '받은 피드백', mobile: '피드백' },
      value: `${allFeedbacks.length}건`,
      icon: MessageSquare,
      color: 'text-primary',
    },
  ];

  return (
    <div>
      {/* ── Sticky 정보 헤더 ── */}
      <div
        className={cn(
          'sticky top-0 z-50 w-full border-b border-transparent transition-all ease-out',
          scrolled
            ? 'bg-background/95 supports-[backdrop-filter]:bg-background/50 border-border backdrop-blur-lg shadow'
            : 'bg-background/90',
        )}
      >
      <div className={cn(
        'flex items-center justify-between gap-3 flex-wrap px-3 sm:px-6 py-2.5 transition-all ease-out',
        scrolled && 'py-1.5 sm:px-4',
      )}>

          {/* 좌측: 사용자 정보 */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/40 to-orange-700/30 flex items-center justify-center shrink-0 ring-1 ring-primary/30">
              <span className="text-xs font-bold text-primary">{user?.name?.[0] ?? '?'}</span>
            </div>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-foreground">{user?.name} {user?.position}</span>
              <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">{user?.department}</span>
            </div>
          </div>

          {/* 우측: 핵심 수치 + 버튼 */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* 성장 레벨 */}
            <Badge variant="outline" className="border-primary/50 bg-primary/10 text-primary text-xs font-semibold h-6">
              Lv. {user?.growthLevel ?? (evalData.growthLevel > 0 ? evalData.growthLevel : 1)}
            </Badge>

            {/* 과업 진행 현황 */}
            <span className="text-xs text-muted-foreground hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50">
              <CheckCircle className="h-3 w-3 text-emerald-400" />
              {completedTasks}/{totalTasks}
            </span>

            {/* 점수 */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 h-6">
              <span className="text-xs text-muted-foreground">점수</span>
              <span className="text-xs font-bold text-primary">
                {flooredScore}점
                {exactScore !== flooredScore && (
                  <span className="font-normal text-muted-foreground ml-0.5">({exactScore.toFixed(2)})</span>
                )}
              </span>
            </div>

            {/* 달성 여부 */}
            <div
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer transition-colors h-6 ${
                isAchieved()
                  ? 'bg-emerald-500/10 hover:bg-emerald-500/20'
                  : 'bg-destructive/10 hover:bg-destructive/20'
              }`}
              data-confetti-trigger={isAchieved() ? 'true' : undefined}
              data-not-achieved={!isAchieved() ? 'true' : undefined}
            >
              <span className="text-sm leading-none">{isAchieved() ? '🎉' : '😢'}</span>
              <span className={`text-xs font-semibold ${isAchieved() ? 'text-emerald-400' : 'text-destructive'}`}>
                {isAchieved() ? '달성' : '미달성'}
              </span>
            </div>

            {/* 평가 가이드 */}
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => setShowEvaluationGuide(true)}
            >
              <Star className="h-3 w-3 mr-1 text-primary" />
              <span className="hidden sm:inline">평가 가이드</span>
              <span className="inline sm:hidden">가이드</span>
            </Button>
          </div>
        </div>
      </div>

      {showEvaluationGuide && (
        <EvaluationGuide onClose={() => setShowEvaluationGuide(false)} />
      )}

      <div className="p-3 sm:p-4">
      <Tabs value={selectedTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="tasks" className="text-xs sm:text-sm flex items-center">
            <span className="hidden sm:inline">내 과업</span>
            <span className="inline sm:hidden">과업</span>
          </TabsTrigger>
          <TabsTrigger value="schedule" className="text-xs sm:text-sm flex items-center">
            <span className="hidden sm:inline">과업 일정</span>
            <span className="inline sm:hidden">일정</span>
          </TabsTrigger>
          <TabsTrigger value="feedback" className="text-xs sm:text-sm flex items-center">
            <span className="hidden sm:inline">피드백 이력</span>
            <span className="inline sm:hidden">피드백</span>
            {!allFeedbacksBadgeRead && newFeedbackCount > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 w-5 flex items-center justify-center text-xs p-0">{newFeedbackCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base sm:text-lg">내 과업 목록</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">과업을 클릭하면 상세 내용과 피드백을 확인하고 수정할 수 있습니다</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative min-h-[200px]">
              <TaskListingComponent tasks={evalData.tasks} onSaveTask={handleInlineTaskSave} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg flex items-center">
                <CalendarIcon className="w-5 h-5 mr-2 text-primary" />
                과업 일정표
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">내 과업들의 전체 일정을 간트차트로 확인하세요</CardDescription>
            </CardHeader>
            <CardContent>
              <TaskGanttChart tasks={evalData.tasks} />
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
                              <div className="text-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => toggleTaskFeedbacks(taskTitle)}
                                  className="text-sm"
                                >
                                  {isExpanded ? (
                                    <>
                                      <ChevronUp className="w-4 h-4 mr-1" />
                                      접기
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="w-4 h-4 mr-1" />
                                      {feedbacks.length - 1}개 더보기
                                    </>
                                  )}
                                </Button>
                              </div>
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
      </Tabs>
      </div>
    </div>
  );
};
