import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Target, TrendingUp, Settings, FileText, Calendar, Search, Filter } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useEvaluationDataDB } from '@/hooks/useEvaluationDataDB';
import { initializeEmployeeData } from '@/utils/evaluationUtils';
import { EvaluatorManagement } from '@/components/Settings/EvaluatorManagement';
import { EvaluationMatrix } from '@/components/Settings/EvaluationMatrix';
import { NotificationSettings } from '@/components/Settings/NotificationSettings';
import { DataExport } from '@/components/Settings/DataExport';
import { PromptManagement } from '@/components/Settings/PromptManagement';
import { GeminiTest } from '@/components/GeminiTest';
import { useEvaluatorMappings } from '@/hooks/useEvaluatorMappings';
import { EvaluatorMapping } from '@/types/evaluatorManagement';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const HRDashboard: React.FC = () => {
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const { user } = useAuth();
  const { evaluationData, isLoading } = useEvaluationDataDB(user?.employeeId || '');
  const [overallStats, setOverallStats] = useState<any>({ totalEmployees: 0, completionRate: 0, achievementRate: 0, inProgressEvaluations: 0 });
  const [departmentStats, setDepartmentStats] = useState<any[]>([]);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);

  // Evaluator List states for filtering and pagination
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Initialize new employee data on component mount
  useEffect(() => {
    initializeEmployeeData();
  }, []);

const { mappings: evaluatorList, isLoading: evaluatorLoading, error: evaluatorError } = useEvaluatorMappings();
  const safeEvaluatorList = evaluatorList || [];

  // Handle derived list state for evaluator mappings
  const filteredMappings = safeEvaluatorList.filter(mapping => {
    const matchesSearch = 
      mapping.evaluatorName.toLowerCase().includes(searchTerm.toLowerCase()) || 
      mapping.evaluateeName.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesDept = departmentFilter === 'all' || 
      mapping.evaluatorDepartment === departmentFilter || 
      mapping.evaluateeDepartment === departmentFilter;

    return matchesSearch && matchesDept;
  });

  const totalPages = Math.ceil(filteredMappings.length / itemsPerPage) || 1;
  const currentMappings = filteredMappings.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Sync component state with DB data
  useEffect(() => {
    if (!evaluationData) return;
    // Compute overall stats (simple placeholder logic)
    const totalEmployees = evaluationData.tasks?.length ?? 0;
    const completed = evaluationData.tasks?.filter(t => t.score !== undefined).length ?? 0;
    const completionRate = totalEmployees ? Math.round((completed / totalEmployees) * 100) : 0;
    setOverallStats({
      totalEmployees,
      completionRate,
      achievementRate: 0,
      inProgressEvaluations: evaluationData.evaluationStatus === 'in-progress' ? 1 : 0,
    });
    // Placeholder: empty department and recent activity data
    setDepartmentStats([]);
    setRecentActivities([]);
  }, [evaluationData]);

  const overviewStatsData = [
    {
      label: '전체 직원 수',
      value: overallStats.totalEmployees.toString(),
      icon: Users,
      color: 'text-primary'
    },
    {
      label: '평가 완료율',
      value: `${overallStats.completionRate}%`,
      icon: Target,
      color: 'text-emerald-400'
    },
    {
      label: '달성률',
      value: `${overallStats.achievementRate}%`,
      icon: TrendingUp,
      color: 'text-amber-400'
    },
    {
      label: '진행 중인 평가',
      value: `${overallStats.inProgressEvaluations}개`,
      icon: Settings,
      color: 'text-primary'
    },
  ];

  const handleModalOpen = (modalType: string) => {
    setActiveModal(modalType);
  };

  const handleModalClose = () => {
    setActiveModal(null);
    // Refresh data when modal closes
    // Data is refreshed automatically via the evaluation hook; no manual refresh needed.
  };

  if (activeModal) {
    return (
      <div className="p-6">
        {activeModal === 'evaluator-management' && <EvaluatorManagement onClose={handleModalClose} />}
        {activeModal === 'evaluation-matrix' && <EvaluationMatrix onClose={handleModalClose} />}
        {activeModal === 'notification-settings' && <NotificationSettings onClose={handleModalClose} />}
        {activeModal === 'data-export' && <DataExport onClose={handleModalClose} />}
        {activeModal === 'prompt-management' && <PromptManagement onClose={handleModalClose} />}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">HR 관리자 대시보드</h2>
          <p className="text-muted-foreground">전사 성과관리 현황을 한눈에 확인하세요</p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={() => handleModalOpen('data-export')}>
            <FileText className="mr-2 h-4 w-4" />
            보고서 생성
          </Button>
          <Button onClick={() => handleModalOpen('evaluation-matrix')}>
            <Settings className="mr-2 h-4 w-4" />
            평가 설정
          </Button>
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {overviewStatsData.map((stat, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">전체 현황</TabsTrigger>
          <TabsTrigger value="progress">부서별 진행률</TabsTrigger>
          <TabsTrigger value="activities">최근 활동</TabsTrigger>
          <TabsTrigger value="settings">시스템 설정</TabsTrigger>
  <TabsTrigger value="evaluator-list">평가자 리스트</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>평가 진행 현황</CardTitle>
                <CardDescription>부서별 평가 완료 상황</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {departmentStats.map((dept, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{dept.department}</span>
                      <span className="text-muted-foreground">
                        {dept.completed}/{dept.total} ({dept.percentage}%)
                      </span>
                    </div>
                    <Progress value={dept.percentage} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>이번 달 마감 예정</CardTitle>
                <CardDescription>주요 평가 일정</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-3 p-3 bg-primary/10 rounded-lg">
                  <Calendar className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">연간 평가 마감</p>
                    <p className="text-sm text-muted-foreground">2026년 12월 31일</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3 p-3 bg-amber-500/10 rounded-lg">
                  <Calendar className="h-5 w-5 text-amber-400" />
                  <div>
                    <p className="font-medium">피드백 입력 마감</p>
                    <p className="text-sm text-muted-foreground">2024년 6월 25일</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3 p-3 bg-emerald-500/10 rounded-lg">
                  <Calendar className="h-5 w-5 text-emerald-400" />
                  <div>
                    <p className="font-medium">하반기 평가 시작</p>
                    <p className="text-sm text-muted-foreground">2024년 7월 1일</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="progress" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>부서별 상세 진행률</CardTitle>
              <CardDescription>각 부서의 평가 진행 상황과 세부 통계</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {departmentStats.map((dept, index) => (
                  <div key={index} className="p-4 border border-border rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold">{dept.department}</h3>
                      <Badge variant={dept.percentage >= 80 ? "default" : "secondary"}>
                        {dept.percentage}% 완료
                      </Badge>
                    </div>
                    <Progress value={dept.percentage} className="mb-2" />
                    <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground">
                      <div>완료: {dept.completed}명</div>
                      <div>미완료: {dept.total - dept.completed}명</div>
                      <div>전체: {dept.total}명</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activities" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>최근 활동 내역</CardTitle>
              <CardDescription>시스템에서 발생한 주요 활동들</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentActivities.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    최근 활동 내역이 없습니다.
                  </p>
                ) : (
                  recentActivities.map((activity, index) => (
                    <div key={index} className="flex items-center space-x-3 p-3 bg-muted/30 rounded-lg">
                      <div className={`w-2 h-2 rounded-full ${
                        activity.type === 'complete' ? 'bg-emerald-400' :
                        activity.type === 'update' ? 'bg-primary' :
                        activity.type === 'edit' ? 'bg-amber-400' :
                        'bg-muted-foreground'
                      }`} />
                      <div className="flex-1">
                        <p className="font-medium">{activity.user}</p>
                        <p className="text-sm text-muted-foreground">{activity.action}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">{activity.time}</span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>평가 매트릭스 설정</CardTitle>
                <CardDescription>기여 유형과 범위별 점수 설정</CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => handleModalOpen('evaluation-matrix')}
                >
                  매트릭스 편집
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>평가자 관리</CardTitle>
                <CardDescription>평가자-피평가자 매칭 관리</CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => handleModalOpen('evaluator-management')}
                >
                  매칭 관리
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>알림 설정</CardTitle>
                <CardDescription>시스템 알림 및 마감일 설정</CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => handleModalOpen('notification-settings')}
                >
                  알림 설정
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AI 프롬프트 관리</CardTitle>
                <CardDescription>시스템 가이드라인 및 AI 프롬프트 편집</CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => handleModalOpen('prompt-management')}
                >
                  프롬프트 설정
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>데이터 내보내기</CardTitle>
                <CardDescription>평가 데이터 백업 및 리포트</CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => handleModalOpen('data-export')}
                >
                  데이터 내보내기
                </Button>
              </CardContent>
            </Card>
          </div>
          
          {/* AI 테스트 섹션 */}
          <GeminiTest />
        </TabsContent>
        <TabsContent value="evaluator-list" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>평가자‑피평가자 매칭 현황</CardTitle>
              <CardDescription>등록된 모든 평가자와 피평가자 매칭을 확인합니다</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-4 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="이름이나 사번으로 검색..."
                    className="pl-8"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1); // Reset page on filter change
                    }}
                  />
                </div>
                <div className="w-full sm:w-[180px]">
                  <Select 
                    value={departmentFilter} 
                    onValueChange={(val) => {
                      setDepartmentFilter(val);
                      setCurrentPage(1); // Reset page on filter change
                    }}
                  >
                    <SelectTrigger>
                      <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4" />
                        <SelectValue placeholder="부서 선택" />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체 부서</SelectItem>
                      <SelectItem value="개발팀">개발팀</SelectItem>
                      <SelectItem value="디자인팀">디자인팀</SelectItem>
                      <SelectItem value="기획팀">기획팀</SelectItem>
                      <SelectItem value="영업팀">영업팀</SelectItem>
                      <SelectItem value="HR">HR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

{evaluatorLoading ? (
<p className="text-center text-muted-foreground py-8">로드 중...</p>
) : evaluatorError ? (
<p className="text-center text-destructive py-8">{evaluatorError}</p>
) : safeEvaluatorList.length === 0 ? (
<p className="text-center text-muted-foreground py-8">
  등록된 매칭 정보가 없습니다.
</p>
) : filteredMappings.length === 0 ? (
<p className="text-center text-muted-foreground py-8">
  검색 조건과 일치하는 내역이 없습니다.
</p>
) : (
<div className="space-y-4">
  <div className="overflow-x-auto rounded-md border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>평가자</TableHead>
          <TableHead>평가자 부서</TableHead>
          <TableHead>피평가자</TableHead>
          <TableHead>피평가자 부서</TableHead>
          <TableHead>평가기간</TableHead>
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {currentMappings.map((m, index) => (
          <TableRow key={index}>
            <TableCell className="font-medium">{m.evaluatorName}</TableCell>
            <TableCell>{m.evaluatorDepartment}</TableCell>
            <TableCell>{m.evaluateeName}</TableCell>
            <TableCell>{m.evaluateeDepartment}</TableCell>
            <TableCell>{m.evaluationPeriod}</TableCell>
            <TableCell>
              <Badge variant={m.status === 'active' ? 'default' : 'secondary'}>
                {m.status === 'active' ? '활성' : '비활성'}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
  
  <div className="flex items-center justify-between">
    <div className="text-sm text-muted-foreground">
      총 {filteredMappings.length}건 중 {(currentPage - 1) * itemsPerPage + 1}-
      {Math.min(currentPage * itemsPerPage, filteredMappings.length)}건 표시
    </div>
    <div className="flex items-center space-x-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
        disabled={currentPage === 1}
      >
        이전
      </Button>
      <div className="text-sm font-medium">
        {currentPage} / {totalPages}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
        disabled={currentPage === totalPages}
      >
        다음
      </Button>
    </div>
  </div>
</div>
)}
            </CardContent>
</Card>
</TabsContent>
      </Tabs>
    </div>
  );
};
