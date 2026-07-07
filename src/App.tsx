import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { FullScreenLoader } from "@/components/ui/loader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/api";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ORG_KPI_ENABLED } from "@/lib/featureFlags";
import { EvaluationMatrixProvider } from "@/contexts/EvaluationMatrixContext";
import { ExpectationProvider } from "@/contexts/ExpectationContext";
import { NotificationProviderDB } from "@/contexts/NotificationContextDB";
import { EvaluationPeriodProvider } from "@/contexts/EvaluationPeriodContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/Layout/AppLayout";

// 첫 진입 화면(로그인)·404는 작고 즉시 필요하므로 eager. 나머지 페이지는 역할군별 청크로 lazy 분할 —
// 피평가자가 HR 페이지(+xlsx·recharts)까지 한 번에 받지 않도록.
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const Evaluation = lazy(() => import("./pages/Evaluation"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const KpiManagePage = lazy(() => import("./pages/kpi/KpiManagePage"));

const MyHome = lazy(() => import("./pages/my/Home"));
const MyTasksPage = lazy(() => import("./pages/my/MyTasksPage"));
const MyFeedbackPage = lazy(() => import("./pages/my/MyFeedbackPage"));
const MyQnaPage = lazy(() => import("./pages/my/MyQnaPage"));
const EvaluatorRequestPage = lazy(() => import("./pages/EvaluatorRequestPage"));

const TeamHome = lazy(() => import("./pages/team/Home"));
const TeamMembersPage = lazy(() => import("./pages/team/TeamMembersPage"));
const EvaluatorFeedbackPage = lazy(() => import("./pages/team/EvaluatorFeedbackPage"));
const DeptMemberViewerPage = lazy(() => import("./pages/team/DeptMemberViewerPage"));
const HrEvaluationViewerPage = lazy(() => import("./pages/hr/HrEvaluationViewerPage"));
const EvaluatorQnaPage = lazy(() => import("./pages/team/EvaluatorQnaPage"));

const HrHome = lazy(() => import("./pages/hr/Home"));
const HrPeriodsPage = lazy(() => import("./pages/hr/HrPeriodsPage"));
const HrDepartmentsPage = lazy(() => import("./pages/hr/HrDepartmentsPage"));
const HrMatrixPage = lazy(() => import("./pages/hr/HrMatrixPage"));
const HrUsersPage = lazy(() => import("./pages/hr/HrUsersPage"));
const HrSettingsPage = lazy(() => import("./pages/hr/HrSettingsPage"));
const HrChangeRequestsPage = lazy(() => import("./pages/hr/ChangeRequestsPage"));
const HrRemindersPage = lazy(() => import("./pages/hr/RemindersPage"));
const HrNoticesFaqPage = lazy(() => import("./pages/hr/HrNoticesFaqPage"));
const HrInsightsPage = lazy(() => import("./pages/hr/HrInsightsPage"));
const HrPeopleSearchPage = lazy(() => import("./pages/hr/HrPeopleSearchPage"));
const HrAuditLogPage = lazy(() => import("./pages/hr/HrAuditLogPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 내부 운영툴: 마운트마다 재조회·창 포커스 재조회를 줄여 중복 fetch 제거.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // 4xx(클라이언트 오류·401/403)는 재시도 무의미(401 은 apiFetch 가 이미 로그아웃 처리).
      // 5xx·네트워크 오류만 1회 재시도.
      retry: (failureCount, error) => {
        if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 1;
      },
    },
  },
});

const RoleRedirect = () => {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'hr') return <Navigate to="/hr" replace />;
  if (user.role === 'evaluator') return <Navigate to="/team" replace />;
  return <Navigate to="/my" replace />;
};

const AppShell = () => {
  // 라우트가 바뀌면 페이지 에러를 자동 해제 — 다른 메뉴로 이동하면 복구된다.
  const location = useLocation();
  return (
    <ProtectedRoute>
      <EvaluationPeriodProvider>
        <AppLayout>
          <ErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<FullScreenLoader message="화면을 불러오는 중입니다…" />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </AppLayout>
      </EvaluationPeriodProvider>
    </ProtectedRoute>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
    <TooltipProvider>
      <Toaster />
      <ConfirmDialogProvider>
      <AuthProvider>
        <EvaluationMatrixProvider>
          <ExpectationProvider>
          <NotificationProviderDB>
            <BrowserRouter>
              <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<RoleRedirect />} />

              <Route element={<AppShell />}>
                <Route path="/notifications" element={<NotificationsPage />} />
                {/* 조직 KPI — HR·평가자 관리 페이지. 피평가자는 전용 페이지 없이 내 대시보드의
                    조직 KPI 요약 카드로만 열람(2026-07-07). 플래그 OFF(기본)면 라우트 자체가 없어 404. */}
                {ORG_KPI_ENABLED && (
                  <Route
                    path="/kpi"
                    element={
                      <ProtectedRoute allowedRoles={["hr", "evaluator"]}>
                        <KpiManagePage />
                      </ProtectedRoute>
                    }
                  />
                )}
                {/* 피평가자 */}
                <Route
                  path="/my"
                  element={
                    <ProtectedRoute allowedRoles={["evaluatee"]}>
                      <MyHome />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/my/tasks"
                  element={
                    <ProtectedRoute allowedRoles={["evaluatee"]}>
                      <MyTasksPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/my/feedback"
                  element={
                    <ProtectedRoute allowedRoles={["evaluatee"]}>
                      <MyFeedbackPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/my/evaluator-request"
                  element={
                    <ProtectedRoute allowedRoles={["evaluatee"]}>
                      <EvaluatorRequestPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/my/ai"
                  element={
                    <ProtectedRoute allowedRoles={["evaluatee"]}>
                      <MyQnaPage />
                    </ProtectedRoute>
                  }
                />

                {/* 평가자 — 메인은 평가 보드(구 팀 통계 대시보드는 폐지, 핵심 차트는 보드에 통합) */}
                <Route
                  path="/team"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <TeamHome />
                    </ProtectedRoute>
                  }
                />
                {/* 구 평가 보드 경로 → 메인으로 통합(북마크 유지) */}
                <Route path="/team/board" element={<Navigate to="/team" replace />} />
                <Route
                  path="/team/members"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <TeamMembersPage />
                    </ProtectedRoute>
                  }
                />
                {/* 구 팀 통계·전체 일정(간트) 경로 → 메인(평가 보드)으로 통합(북마크 유지) */}
                <Route path="/team/scores" element={<Navigate to="/team" replace />} />
                <Route path="/team/schedule" element={<Navigate to="/team" replace />} />
                <Route
                  path="/team/dept-member"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <DeptMemberViewerPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/team/feedback"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <EvaluatorFeedbackPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/team/ai"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <EvaluatorQnaPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/team/evaluator-request"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <EvaluatorRequestPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/evaluation/:id"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <Evaluation />
                    </ProtectedRoute>
                  }
                />

                {/* HR */}
                <Route
                  path="/hr"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrHome />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/departments"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrDepartmentsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/periods"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrPeriodsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/matrix"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrMatrixPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/users"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrUsersPage />
                    </ProtectedRoute>
                  }
                />
                {/* 매칭 정합성 점검은 사용자 관리로 흡수(무결성 경고 배너). 북마크는 사용자 관리로 */}
                <Route path="/hr/matching" element={<Navigate to="/hr/users" replace />} />
                <Route
                  path="/hr/change-requests"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrChangeRequestsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/audit-logs"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrAuditLogPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/settings"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrSettingsPage />
                    </ProtectedRoute>
                  }
                />
                {/* AI 프롬프트 관리는 시스템 설정 탭으로 통합(북마크 유지) */}
                <Route path="/hr/prompts" element={<Navigate to="/hr/settings?tab=prompts" replace />} />
                <Route
                  path="/hr/reminders"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrRemindersPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/notices-faq"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrNoticesFaqPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/insights"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrInsightsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/people-search"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrPeopleSearchPage />
                    </ProtectedRoute>
                  }
                />
                {/* 구 분석 경로 → 평가 인사이트 탭으로 리다이렉트(북마크 유지) */}
                <Route path="/hr/quality" element={<Navigate to="/hr/insights?tab=evaluator" replace />} />
                <Route path="/hr/job-role-benchmark" element={<Navigate to="/hr/insights?tab=job" replace />} />
                <Route path="/hr/results" element={<Navigate to="/hr/insights?tab=org" replace />} />
                {/* 개인 피드백 리포트는 피평가자 평가 열람과 중복이라 제거 → 열람으로 리다이렉트 */}
                <Route path="/hr/individual-feedback-report" element={<Navigate to="/hr/evaluation-viewer" replace />} />
                <Route
                  path="/hr/evaluation-viewer"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrEvaluationViewerPage />
                    </ProtectedRoute>
                  }
                />
              </Route>

              <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </NotificationProviderDB>
          </ExpectationProvider>
        </EvaluationMatrixProvider>
      </AuthProvider>
      </ConfirmDialogProvider>
    </TooltipProvider>
    </ErrorBoundary>
  </QueryClientProvider>
);

export default App;
