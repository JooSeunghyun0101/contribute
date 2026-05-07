import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, CheckCircle, Clock, MessageSquare, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EvaluationGuide from './EvaluationGuide';
import TaskGanttChart from '@/components/TaskGanttChart';
import MiniGanttChart from '@/components/MiniGanttChart';
import { EvaluationStatus } from '@/types';
import { Task } from '@/types/evaluation';
import { employeeService, evaluationService, taskService, feedbackService } from '@/lib/services';
import { useNotifications } from '@/contexts/NotificationContextDB';

interface EvaluationData {
  evaluateeId: string;
  evaluateeName: string;
  evaluateePosition: string;
  evaluateeDepartment: string;
  growthLevel: number;
  evaluationStatus: EvaluationStatus;
  lastModified: string;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    weight: number;
    contributionMethod?: string;
    contributionScope?: string;
    score?: number;
    feedback?: string;
    feedbackDate?: string;
    lastModified?: string;
    evaluatorName?: string;
    startDate?: string;
    endDate?: string;
    feedbackHistory?: Array<{
      id: string;
      content: string;
      date: string;
      evaluatorName: string;
    }>;
  }>;
}

interface EvaluateeInfo {
  id: string;
  name: string;
  position: string;
  department: string;
  progress: number;
  tasksCompleted: number;
  totalTasks: number;
  lastActivity: string;
  status: 'in-progress' | 'completed';
  totalScore?: number;
  exactScore?: number;
  growthLevel?: number;
}

interface RecentFeedback {
  evaluatee: string;
  task: string;
  feedback: string;
  date: string;
  score: string;
  evaluatorName?: string;
}

interface TaskFeedbacks {
  [taskTitle: string]: RecentFeedback[];
}

// Employee mapping - evaluator to evaluatees (updated with new positions)
const evaluatorMapping: Record<string, Array<{id: string, name: string, position: string, department: string, growthLevel: number}>> = {
  'H0908033': [ // 박판근
    { id: 'H1310172', name: '이수한', position: '차장', department: '인사기획팀', growthLevel: 3 },
    { id: 'H1411166', name: '주승현', position: '차장', department: '인사기획팀', growthLevel: 3 },
    { id: 'H1911042', name: '김민선', position: '대리', department: '인사기획팀', growthLevel: 2 }
  ],
  'H1310159': [ // 김남엽
    { id: 'H1411231', name: '최은송', position: '차장', department: '인사팀', growthLevel: 3 },
    { id: 'H1205006', name: '황정원', position: '대리', department: '인사팀', growthLevel: 2 },
    { id: 'H2301040', name: '김민영', position: '사원', department: '인사팀', growthLevel: 1 },
    { id: 'H1501077', name: '조혜인', position: '대리', department: '인사팀', growthLevel: 2 }
  ],
  'H0807021': [ // 박준형
    { id: 'H0908033', name: '박판근', position: '차장', department: '인사기획팀', growthLevel: 3 },
    { id: 'H1310159', name: '김남엽', position: '차장', department: '인사팀', growthLevel: 3 }
  ]
};

export const EvaluatorDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { notifications } = useNotifications();
  const [evaluatees, setEvaluatees] = useState<EvaluateeInfo[]>([]);
  const [taskFeedbacks, setTaskFeedbacks] = useState<TaskFeedbacks>({});
  const [showAllFeedbacks, setShowAllFeedbacks] = useState<Record<string, boolean>>({});
  const [showEvaluationGuide, setShowEvaluationGuide] = useState(false);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [evaluateeTasks, setEvaluateeTasks] = useState<Record<string, Task[]>>({});
  const [selectedTab, setSelectedTab] = useState('evaluatees');
  const [pendingBadgeRead, setPendingBadgeRead] = useState(false);

  // 데이터베이스에서 localStorage로 동기화하는 함수
  const syncDataFromDatabase = async () => {
    if (!user) return;

    try {

      // 내가 평가하는 직원들 조회
      const myEvaluatees = await employeeService.getEvaluateesByEvaluator(user.employeeId);

      for (const employee of myEvaluatees) {
        
        // 각 직원의 평가 데이터 조회
        const evaluation = await evaluationService.getEvaluationByEmployeeId(employee.employee_id);
        if (!evaluation) {
          continue;
        }

        // 해당 평가의 과업들 조회
        let dbTasks = await taskService.getTasksByEvaluationId(evaluation.id);
        dbTasks = dbTasks.filter((t: any) => !t.deleted_at);
        
        // 각 과업의 피드백 히스토리 로드
        const tasksWithHistory = await Promise.all(
          dbTasks.map(async (task) => {
            
            let feedbackHistory: any[] = [];
            try {
              feedbackHistory = await feedbackService.getFeedbackHistoryByTaskId(task.task_id);
                          } catch (error) {
              console.error('❌ 피드백 히스토리 조회 실패:', error);
              feedbackHistory = [];
            }
            
            return {
              id: task.task_id, // task_id를 id로 사용 (기존 코드 호환성)
              title: task.title,
              description: task.description || '',
              weight: task.weight,
              startDate: task.start_date || undefined,
              endDate: task.end_date || undefined,
              contributionMethod: task.contribution_method || undefined,
              contributionScope: task.contribution_scope || undefined,
              score: task.score || undefined,
              feedback: task.feedback || undefined,
              feedbackDate: task.feedback_date || undefined,
              evaluatorName: task.evaluator_name || undefined,
              lastModified: (task as any).updated_at || new Date().toISOString(),
              feedbackHistory: feedbackHistory.map(fh => ({
                id: fh.id,
                content: fh.content,
                date: fh.created_at,
                evaluatorName: fh.evaluator_name || '평가자',
                evaluatorId: user.id || 'unknown'
              }))
            };
          })
        );

        // EvaluationData 형태로 변환
        const evaluationData = {
          evaluateeId: evaluation.evaluatee_id,
          evaluateeName: evaluation.evaluatee_name,
          evaluateePosition: evaluation.evaluatee_position,
          evaluateeDepartment: evaluation.evaluatee_department,
          growthLevel: evaluation.growth_level,
          evaluationStatus: evaluation.evaluation_status,
          lastModified: evaluation.last_modified,
          tasks: tasksWithHistory
        };

        
        // localStorage에 저장 (기존 로직과 호환성 유지)
        localStorage.setItem(`evaluation-${employee.employee_id}`, JSON.stringify(evaluationData));
      }

    } catch (error) {
      console.error('❌ 데이터베이스 동기화 실패:', error);
    }
  };

  const loadEvaluationData = async () => {
    if (!user) return;
    
    // 먼저 데이터베이스에서 최신 데이터를 localStorage로 동기화
    await syncDataFromDatabase();

    try {
      // Get evaluatees for current evaluator from database
      const myEvaluateesFromDB = await employeeService.getEvaluateesByEvaluator(user.employeeId);
      
      // Convert to expected format for compatibility
      const myEvaluatees = myEvaluateesFromDB.map(emp => ({
        id: emp.employee_id,
        name: emp.name,
        position: emp.position,
        department: emp.department,
        growthLevel: emp.growth_level
      }));

      const updatedEvaluatees: EvaluateeInfo[] = [];
      const feedbacksByTask: TaskFeedbacks = {};
      const combinedTasks: Task[] = [];
      const tasksByEvaluatee: Record<string, Task[]> = {};

      myEvaluatees.forEach(evaluatee => {
        const savedData = localStorage.getItem(`evaluation-${evaluatee.id}`);
      
      if (savedData) {
        try {
          const evaluationData: EvaluationData = JSON.parse(savedData);
          const completedTasks = evaluationData.tasks.filter(task => task.score !== undefined).length;
          const progress = Math.round((completedTasks / evaluationData.tasks.length) * 100);
          
          // Calculate exact and floored scores
          const exactScore = Math.round(evaluationData.tasks.reduce((sum, task) => {
            if (task.score) {
              return sum + (task.score * task.weight / 100);
            }
            return sum;
          }, 0) * 10) / 10;
          const flooredScore = Math.floor(exactScore);

          const status = evaluationData.evaluationStatus;

          // Extract feedback data grouped by task - improved to include all feedback history
          evaluationData.tasks.forEach((task) => {
            const taskKey = `${evaluationData.evaluateeName}: ${task.title}`;
            
            // Initialize feedback array for this task if it doesn't exist
            if (!feedbacksByTask[taskKey]) {
              feedbacksByTask[taskKey] = [];
            }

            // Add current feedback if exists
            if (task.feedback && task.feedback.trim()) {
              feedbacksByTask[taskKey].push({
                evaluatee: `${evaluationData.evaluateeName} ${evaluationData.evaluateePosition}`,
                task: task.title,
                feedback: task.feedback,
                date: task.feedbackDate || task.lastModified || evaluationData.lastModified,
                score: task.score ? `${task.score}점` : '평가중',
                evaluatorName: task.evaluatorName || user.name
              });
            }

            // Add all feedback history if exists
            if (task.feedbackHistory && task.feedbackHistory.length > 0) {
              task.feedbackHistory.forEach(historyItem => {
                feedbacksByTask[taskKey].push({
                  evaluatee: `${evaluationData.evaluateeName} ${evaluationData.evaluateePosition}`,
                  task: task.title,
                  feedback: historyItem.content,
                  date: historyItem.date,
                  score: task.score ? `${task.score}점` : '평가중',
                  evaluatorName: historyItem.evaluatorName
                });
              });
            }
          });

          // Add tasks to combined list and individual evaluatee list - fix the type error
          const evaluateeTasks = evaluationData.tasks.map(task => ({
            ...task,
            title: `${evaluatee.name}: ${task.title}`,
            evaluateeId: evaluatee.id,
            evaluateeName: evaluatee.name,
            // Ensure feedbackHistory has the correct type with evaluatorId
            feedbackHistory: (task.feedbackHistory || []).map(historyItem => ({
              id: historyItem.id,
              content: historyItem.content,
              date: historyItem.date,
              evaluatorName: historyItem.evaluatorName,
              evaluatorId: (historyItem as any).evaluatorId || user.id || 'unknown'
            }))
          } as Task & { evaluateeId: string; evaluateeName: string }));

          combinedTasks.push(...evaluateeTasks);
          
          // Fix the individual evaluatee tasks to also have proper feedbackHistory
          const fixedEvaluateeTasks = evaluationData.tasks.map(task => ({
            ...task,
            feedbackHistory: (task.feedbackHistory || []).map(historyItem => ({
              id: historyItem.id,
              content: historyItem.content,
              date: historyItem.date,
              evaluatorName: historyItem.evaluatorName,
              evaluatorId: (historyItem as any).evaluatorId || user.id || 'unknown'
            }))
          }));
          
          tasksByEvaluatee[evaluatee.id] = fixedEvaluateeTasks;

          updatedEvaluatees.push({
            id: evaluatee.id,
            name: evaluatee.name,
            position: evaluatee.position,
            department: evaluatee.department,
            progress,
            tasksCompleted: completedTasks,
            totalTasks: evaluationData.tasks.length,
            lastActivity: new Date(evaluationData.lastModified).toLocaleDateString('ko-KR', {
              month: 'short',
              day: 'numeric'
            }),
            status,
            totalScore: flooredScore,
            exactScore: exactScore,
            growthLevel: evaluationData.growthLevel
          });
        } catch (error) {
          console.error(`Failed to parse evaluation data for ${evaluatee.id}:`, error);
        }
      }
      
      // Return default data if no saved evaluation found
      if (!savedData) {
        updatedEvaluatees.push({
          id: evaluatee.id,
          name: evaluatee.name,
          position: evaluatee.position,
          department: evaluatee.department,
          progress: 0,
          tasksCompleted: 0,
          totalTasks: 4,
          lastActivity: '미시작',
          status: 'in-progress' as const,
          totalScore: 0,
          exactScore: 0,
          growthLevel: evaluatee.growthLevel
        });
        tasksByEvaluatee[evaluatee.id] = [];
      }
    });

    // Sort feedbacks by date within each task group (most recent first)
    Object.keys(feedbacksByTask).forEach(taskKey => {
      feedbacksByTask[taskKey].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      feedbacksByTask[taskKey] = feedbacksByTask[taskKey].map(feedback => ({
        ...feedback,
        date: new Date(feedback.date).toLocaleDateString('ko-KR', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      }));
    });

      
      setEvaluatees(updatedEvaluatees);
      setTaskFeedbacks(feedbacksByTask);
      setAllTasks(combinedTasks);
      setEvaluateeTasks(tasksByEvaluatee);
      
      
    } catch (error) {
      console.error('❌ 평가자 대시보드 데이터 로드 실패:', error);
    }
  };

  // Load data on mount - DB 연동 우선
  useEffect(() => {
    const loadData = async () => {
      
      try {
        // 먼저 DB에서 동기화
        await syncDataFromDatabase();
        // 그 다음 localStorage 데이터 로드
        await loadEvaluationData();
        
      } catch (error) {
        console.error('❌ 평가자 대시보드 데이터 로드 실패:', error);
        // DB 실패 시 localStorage에서라도 로드
        await loadEvaluationData();
      }
    };

    if (user) {
      loadData();
    }
  }, [user]);

  // 자동 새로고침 제거 - 저장/완료 버튼 클릭 시에만 새로고침
  
  // 알림 변경 감지하여 데이터 새로고침 (저장/완료 버튼 클릭 시)
  useEffect(() => {
    if (user && notifications.length > 0) {
      const latestNotification = notifications[0];
      const isRecent = new Date().getTime() - new Date(latestNotification.createdAt).getTime() < 5000; // 5초 이내
      
      if (isRecent && (latestNotification.type === 'task_summary' || latestNotification.type === 'task_content_changed')) {
        loadEvaluationData();
      }
    }
  }, [notifications, user]);

  const totalFeedbackCount = Object.values(taskFeedbacks).reduce((sum, feedbacks) => sum + feedbacks.length, 0);

  const myStats = [
    {
      label: { full: '담당 피평가자', mobile: '피평가자' },
      value: `${evaluatees.length}명`,
      icon: Users,
      color: 'text-primary'
    },
    {
      label: { full: '완료한 평가', mobile: '완료' },
      value: `${evaluatees.filter(e => e.status === 'completed').length}건`,
      icon: CheckCircle,
      color: 'text-emerald-400'
    },
    {
      label: { full: '대기 중인 평가', mobile: '대기중' },
      value: `${evaluatees.filter(e => e.status === 'in-progress').length}건`,
      icon: Clock,
      color: 'text-amber-400'
    },
    {
      label: { full: '작성한 피드백', mobile: '피드백' },
      value: `${totalFeedbackCount}건`,
      icon: MessageSquare,
      color: 'text-primary'
    },
  ];

  const handleEvaluateClick = (evaluateeId: string) => {
    navigate(`/evaluation/${evaluateeId}`);
  };

  const toggleShowAllFeedbacks = (taskKey: string) => {
    setShowAllFeedbacks(prev => ({
      ...prev,
      [taskKey]: !prev[taskKey]
    }));
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight">
            <span className="hidden md:inline">평가자 대시보드</span>
            <span className="inline md:hidden">평가 대시보드</span>
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            <span className="hidden md:inline">담당 팀원들의 성과를 평가하고 피드백을 제공하세요</span>
            <span className="inline md:hidden">담당 팀원 평가 및 피드백</span>
          </p>
        </div>
        <Button 
          variant="outline"
          className="text-xs sm:text-sm px-2 sm:px-4"
          onClick={() => setShowEvaluationGuide(true)}
        >
          <Star className="mr-1 sm:mr-2 h-3 w-3 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline">평가 가이드</span>
          <span className="inline sm:hidden">가이드</span>
        </Button>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        {myStats.map((stat, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">
                <span className="hidden sm:inline">{stat.label.full}</span>
                <span className="inline sm:hidden">{stat.label.mobile}</span>
              </CardTitle>
              <stat.icon className={`h-3 w-3 sm:h-4 sm:w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-lg sm:text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={selectedTab} onValueChange={(tab) => {
        setSelectedTab(tab);
        if (tab === 'pending') setPendingBadgeRead(true);
      }} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="evaluatees" className="text-xs sm:text-sm flex items-center">
            <span className="hidden sm:inline">담당 피평가자</span>
            <span className="inline sm:hidden">피평가자</span>
          </TabsTrigger>
          <TabsTrigger value="schedule" className="text-xs sm:text-sm flex items-center">
            <span className="hidden sm:inline">전체 일정</span>
            <span className="inline sm:hidden">일정</span>
          </TabsTrigger>
          <TabsTrigger value="pending" className="text-xs sm:text-sm flex items-center">
            <span className="hidden sm:inline">대기 중인 평가</span>
            <span className="inline sm:hidden">대기중</span>
            {!pendingBadgeRead && evaluatees.filter(e => e.status === 'in-progress').length > 0 && (
              <Badge variant="destructive" className="ml-2 h-5 w-5 flex items-center justify-center text-xs p-0">{evaluatees.filter(e => e.status === 'in-progress').length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="completed" className="text-xs sm:text-sm flex items-center">
            <span className="hidden sm:inline">완료한 평가</span>
            <span className="inline sm:hidden">완료</span>
          </TabsTrigger>
          <TabsTrigger value="feedback" className="text-xs sm:text-sm flex items-center">
            <span className="hidden sm:inline">피드백 내역</span>
            <span className="inline sm:hidden">피드백</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="evaluatees" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {evaluatees.map((person, index) => (
              <Card key={index}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base sm:text-lg">{person.name} {person.position}</CardTitle>
                      <CardDescription className="text-xs sm:text-sm">{person.department}</CardDescription>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge 
                        variant={person.status === 'completed' ? 'default' : 'secondary'}
                        className={person.status === 'completed' ? 'status-achieved' : 'status-in-progress'}
                      >
                        {person.status === 'completed' ? '완료' : '진행 중'}
                      </Badge>
                      {person.totalScore !== undefined && person.growthLevel && (
                        <div className="text-xs text-muted-foreground">
                          {person.exactScore && person.exactScore !== person.totalScore 
                            ? `${person.totalScore}점(${person.exactScore.toFixed(2)})/Lv.${person.growthLevel}`
                            : `${person.totalScore}점/Lv.${person.growthLevel}`
                          }
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs sm:text-sm mb-2">
                      <span>과업 일정</span>
                      <span>{person.tasksCompleted}/{person.totalTasks} 완료</span>
                    </div>
                    <MiniGanttChart tasks={evaluateeTasks[person.id] || []} />
                  </div>
                  
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs sm:text-sm text-muted-foreground">
                      마지막 활동: {person.lastActivity}
                    </span>
                    <Button 
                      size="sm" 
                      onClick={() => handleEvaluateClick(person.id)}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 transition-all duration-200 text-xs sm:text-sm px-2 sm:px-4"
                    >
                      평가하기
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">전체 과업 일정</CardTitle>
              <CardDescription className="text-xs sm:text-sm">담당 피평가자들의 모든 과업 일정을 확인하세요</CardDescription>
            </CardHeader>
            <CardContent>
              <TaskGanttChart tasks={allTasks} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pending" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">대기 중인 평가 항목</CardTitle>
              <CardDescription className="text-xs sm:text-sm">아직 완료되지 않은 평가들입니다</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {evaluatees.filter(person => person.status === 'in-progress').map((person, index) => (
                  <div key={index} className="flex items-center justify-between p-3 sm:p-4 border rounded-lg">
                    <div>
                      <p className="font-medium text-sm sm:text-base">{person.name} {person.position}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground">
                        미완료 과업: {person.totalTasks - person.tasksCompleted}개 • 진행률: {person.progress}%
                      </p>
                    </div>
                    <Button 
                      size="sm" 
                      onClick={() => handleEvaluateClick(person.id)}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs sm:text-sm px-2 sm:px-4"
                    >
                      <span className="hidden sm:inline">평가 진행</span>
                      <span className="inline sm:hidden">진행</span>
                    </Button>
                  </div>
                ))}
                {evaluatees.filter(person => person.status === 'in-progress').length === 0 && (
                  <p className="text-center text-muted-foreground py-8 text-sm">대기 중인 평가가 없습니다.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">완료한 평가</CardTitle>
              <CardDescription className="text-xs sm:text-sm">완료된 평가 결과입니다</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {evaluatees.filter(person => person.status === 'completed').map((person, index) => (
                  <div key={index} className="p-3 sm:p-4 border rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-medium text-sm sm:text-base">{person.name} {person.position}</p>
                        <p className="text-xs sm:text-sm text-muted-foreground">{person.department}</p>
                      </div>
                      <div className="text-right">
                        <Badge className="status-achieved mb-1 text-xs">평가 완료</Badge>
                        <p className="text-xs sm:text-sm text-muted-foreground">
                          총점: {person.exactScore && person.exactScore !== person.totalScore 
                            ? `${person.totalScore}점(${person.exactScore.toFixed(2)})`
                            : `${person.totalScore}점`
                          } / 목표: {person.growthLevel}점
                        </p>
                      </div>
                    </div>
                    <div className="text-xs sm:text-sm text-muted-foreground">
                      완료일: {person.lastActivity} • 총 {person.totalTasks}개 과업 평가
                    </div>
                  </div>
                ))}
                {evaluatees.filter(person => person.status === 'completed').length === 0 && (
                  <p className="text-center text-muted-foreground py-8 text-sm">완료된 평가가 없습니다.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">작성한 피드백 (과업별)</CardTitle>
              <CardDescription className="text-xs sm:text-sm">과업별로 작성한 피드백 내역 (최신순)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {Object.entries(taskFeedbacks).map(([taskKey, feedbacks]) => (
                  <div key={taskKey} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-medium text-sm sm:text-base">{taskKey}</h3>
                      <Badge variant="outline" className="text-xs">
                        {feedbacks.length}개 피드백
                      </Badge>
                    </div>
                    
                    {/* Show latest feedback only initially */}
                    {feedbacks.length > 0 && (
                      <div className="space-y-3">
                        <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs sm:text-sm font-medium">
                              평가자: {feedbacks[0].evaluatorName || '평가자 미확인'}
                            </span>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="border-primary/30 text-primary text-xs">
                                {feedbacks[0].score}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{feedbacks[0].date}</span>
                            </div>
                          </div>
                          <p className="text-xs sm:text-sm text-foreground">
                            {feedbacks[0].feedback}
                          </p>
                        </div>

                        {/* Show additional feedbacks if expanded */}
                        {showAllFeedbacks[taskKey] && feedbacks.slice(1).map((feedback, index) => (
                          <div key={index} className="bg-muted/30 border border-border rounded-md p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs sm:text-sm font-medium">
                                평가자: {feedback.evaluatorName || '평가자 미확인'}
                              </span>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="border-primary/30 text-primary text-xs">
                                  {feedback.score}
                                </Badge>
                                <span className="text-xs text-muted-foreground">{feedback.date}</span>
                              </div>
                            </div>
                            <p className="text-xs sm:text-sm text-foreground">
                              {feedback.feedback}
                            </p>
                          </div>
                        ))}
                        
                        {/* Show more/less button */}
                        {feedbacks.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleShowAllFeedbacks(taskKey)}
                            className="w-full text-xs"
                          >
                            {showAllFeedbacks[taskKey] ? (
                              <>
                                <ChevronUp className="w-3 h-3 mr-1" />
                                접기
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3 h-3 mr-1" />
                                {feedbacks.length - 1}개 더보기
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {Object.keys(taskFeedbacks).length === 0 && (
                  <p className="text-center text-muted-foreground py-8 text-sm">작성된 피드백이 없습니다.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Evaluation Guide Modal */}
      {showEvaluationGuide && (
        <EvaluationGuide onClose={() => setShowEvaluationGuide(false)} />
      )}
    </div>
  );
};
