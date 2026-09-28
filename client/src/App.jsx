import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SnackbarProvider } from "notistack";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeModeProvider } from "./context/ThemeModeContext";
import ProtectedRoute, { homeForRole } from "./routes/ProtectedRoute";

import LoginPage from "./pages/auth/LoginPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import NotFoundPage from "./pages/NotFoundPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import EditTicketPage from "./pages/EditTicketPage";

import RoleAwareLayout from "./components/layout/RoleAwareLayout";
import AdminLayout from "./components/layout/AdminLayout";
import AgentLayout from "./components/layout/AgentLayout";
import PortalLayout from "./components/layout/PortalLayout";

import AdminDashboardPage from "./pages/admin/AdminDashboardPage";
import AllTicketsPage from "./pages/admin/AllTicketsPage";
import UsersPage from "./pages/admin/UsersPage";
import TeamsPage from "./pages/admin/TeamsPage";
import DepartmentsPage from "./pages/admin/DepartmentsPage";
import DepartmentDetailsPage from "./pages/admin/DepartmentDetailsPage";
import EmailTemplatesPage from "./pages/admin/EmailTemplatesPage";
import PrioritiesPage from "./pages/admin/PrioritiesPage";
import AuditLogsPage from "./pages/admin/AuditLogsPage";
import SettingsPage from "./pages/admin/SettingsPage";

import AgentDashboardPage from "./pages/agent/AgentDashboardPage";
import AgentQueuePage from "./pages/agent/AgentQueuePage";

import PortalDashboardPage from "./pages/portal/PortalDashboardPage";
// Shared ticket-creation page — reused as-is under both /portal and /agent,
// never duplicated (see its own file for the role-aware "done" redirect).
import NewTicketPage from "./pages/portal/NewTicketPage";
import MyTicketsPage from "./pages/portal/MyTicketsPage";

function RootRedirect() {
  const { user } = useAuth();
  return <Navigate to={homeForRole(user.role.name)} replace />;
}

export default function App() {
  return (
    <ThemeModeProvider>
      <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              {/* Password reset — intentionally OUTSIDE ProtectedRoute.
                  Unlike /tickets/:id (requires a Solvora session, then
                  checks ticket authorization), these two pages require NO
                  login at all; access is governed entirely by possessing a
                  valid, unexpired, unused reset token (verified server-side
                  by POST /auth/reset-password), not by ProtectedRoute. */}
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />

              {/* Any authenticated role — shell adapts to the caller's role */}
              <Route element={<ProtectedRoute />}>
                <Route element={<RoleAwareLayout />}>
                  <Route path="/" element={<RootRedirect />} />
                  <Route path="/tickets/:id" element={<TicketDetailPage />} />
                  <Route path="/tickets/:id/edit" element={<EditTicketPage />} />
                </Route>
              </Route>

              {/* Admin portal */}
              <Route element={<ProtectedRoute allowedRoles={["ADMIN"]} />}>
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<AdminDashboardPage />} />
                  <Route path="tickets" element={<AllTicketsPage />} />
                  <Route path="users" element={<UsersPage />} />
                  <Route path="teams" element={<TeamsPage />} />
                  <Route path="departments" element={<DepartmentsPage />} />
                  <Route path="departments/:id" element={<DepartmentDetailsPage />} />
                  <Route path="priorities" element={<PrioritiesPage />} />
                  <Route path="email-templates" element={<EmailTemplatesPage />} />
                  <Route path="audit-logs" element={<AuditLogsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Route>

              {/* Manager / Team Lead workspace — both department-management
                  roles share this same portal (role-aware inside
                  AgentDashboardPage/AgentQueuePage), never two separate
                  route trees. */}
              <Route element={<ProtectedRoute allowedRoles={["MANAGER", "TEAMLEAD"]} />}>
                <Route path="/agent" element={<AgentLayout />}>
                  <Route index element={<AgentDashboardPage />} />
                  <Route path="queue" element={<AgentQueuePage />} />
                  <Route path="new-ticket" element={<NewTicketPage />} />
                </Route>
              </Route>

              {/* Employee support portal */}
              <Route element={<ProtectedRoute allowedRoles={["EMPLOYEE"]} />}>
                <Route path="/portal" element={<PortalLayout />}>
                  <Route index element={<PortalDashboardPage />} />
                  <Route path="new-ticket" element={<NewTicketPage />} />
                  <Route path="my-tickets" element={<MyTicketsPage />} />
                </Route>
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </SnackbarProvider>
    </ThemeModeProvider>
  );
}
