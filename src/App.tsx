import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { EvaluationMatrixProvider } from "@/contexts/EvaluationMatrixContext";
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
import HrSettingsPage from "./pages/hr/HrSettingsPage";
import HrPromptsPage from "./pages/hr/HrPromptsPage";

const queryClient = new QueryClient();

const RoleRedirect = () => {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'hr') return <Navigate to="/hr" replace />;
  if (user.role === 'evaluator') return <Navigate to="/team" replace />;
  return <Navigate to="/my" replace />;
};

const AppShell = () => (
  <ProtectedRoute>
    <EvaluationPeriodProvider>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </EvaluationPeriodProvider>
  </ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <EvaluationMatrixProvider>
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

                {/* 평가자 */}
                <Route
                  path="/team"
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
              </Route>

              <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </NotificationProviderDB>
        </EvaluationMatrixProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
