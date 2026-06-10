import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { EvaluationMatrixProvider } from "@/contexts/EvaluationMatrixContext";
import { ExpectationProvider } from "@/contexts/ExpectationContext";
import { NotificationProviderDB } from "@/contexts/NotificationContextDB";
import { EvaluationPeriodProvider } from "@/contexts/EvaluationPeriodContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/Layout/AppLayout";

import Login from "./pages/Login";
import Evaluation from "./pages/Evaluation";
import NotFound from "./pages/NotFound";
import NotificationsPage from "./pages/NotificationsPage";

import MyHome from "./pages/my/Home";
import MyTasksPage from "./pages/my/MyTasksPage";
import MySchedulePage from "./pages/my/MySchedulePage";
import MyFeedbackPage from "./pages/my/MyFeedbackPage";
import EvaluatorRequestPage from "./pages/EvaluatorRequestPage";

import TeamHome from "./pages/team/Home";
import TeamMembersPage from "./pages/team/TeamMembersPage";
import ScoreTablePage from "./pages/team/ScoreTablePage";
import EvaluatorSchedulePage from "./pages/team/EvaluatorSchedulePage";
import EvaluatorFeedbackPage from "./pages/team/EvaluatorFeedbackPage";
import EvaluatorQnaPage from "./pages/team/EvaluatorQnaPage";

import HrHome from "./pages/hr/Home";
import HrPeriodsPage from "./pages/hr/HrPeriodsPage";
import HrDepartmentsPage from "./pages/hr/HrDepartmentsPage";
import HrMatrixPage from "./pages/hr/HrMatrixPage";
import HrUsersPage from "./pages/hr/HrUsersPage";
import HrMatchingPage from "./pages/hr/HrMatchingPage";
import HrSettingsPage from "./pages/hr/HrSettingsPage";
import HrPromptsPage from "./pages/hr/HrPromptsPage";
import HrChangeRequestsPage from "./pages/hr/ChangeRequestsPage";
import HrRemindersPage from "./pages/hr/RemindersPage";
import HrNoticesFaqPage from "./pages/hr/HrNoticesFaqPage";
import HrQualityPage from "./pages/hr/HrQualityPage";
import HrJobRoleBenchmarkPage from "./pages/hr/HrJobRoleBenchmarkPage";
import HrDepartmentResultsPage from "./pages/hr/HrDepartmentResultsPage";
import HrIndividualFeedbackPage from "./pages/hr/HrIndividualFeedbackPage";

const queryClient = new QueryClient();

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
            <Outlet />
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
      <Sonner />
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
                  path="/my/schedule"
                  element={
                    <ProtectedRoute allowedRoles={["evaluatee"]}>
                      <MySchedulePage />
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

                {/* 평가자 */}
                <Route
                  path="/team"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <ScoreTablePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/team/board"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <TeamHome />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/team/members"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <TeamMembersPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/team/scores"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <ScoreTablePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/team/schedule"
                  element={
                    <ProtectedRoute allowedRoles={["evaluator"]}>
                      <EvaluatorSchedulePage />
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
                <Route
                  path="/hr/matching"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrMatchingPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/change-requests"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrChangeRequestsPage />
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
                <Route
                  path="/hr/prompts"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrPromptsPage />
                    </ProtectedRoute>
                  }
                />
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
                  path="/hr/quality"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrQualityPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/job-role-benchmark"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrJobRoleBenchmarkPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/results"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrDepartmentResultsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/hr/individual-feedback-report"
                  element={
                    <ProtectedRoute allowedRoles={["hr"]}>
                      <HrIndividualFeedbackPage />
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
