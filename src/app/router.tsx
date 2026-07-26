import { Navigate, Outlet, RouterProvider, createBrowserRouter } from 'react-router-dom'
import { hasAdminToken } from '../api/auth'
import { AppLayout } from './AppLayout'
import { LoginPage } from '../pages/login/LoginPage'
import { DashboardPage } from '../pages/dashboard/DashboardPage'
import { UsagePage } from '../pages/usage/UsagePage'
import { LogsPage } from '../pages/logs/LogsPage'
import { SessionsPage } from '../pages/sessions/SessionsPage'
import { ProvidersPage } from '../pages/providers/ProvidersPage'
import { ClientsPage } from '../pages/clients/ClientsPage'
import { ClientDetailPage } from '../pages/clients/ClientDetailPage'
import { RoutesPage } from '../pages/routes/RoutesPage'
import { SystemConfigPage } from '../pages/config/SystemConfigPage'

function RequireAuth() {
  if (!hasAdminToken()) return <Navigate to="/login" replace />
  return <Outlet />
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'sessions', element: <SessionsPage /> },
          { path: 'providers', element: <ProvidersPage /> },
          { path: 'clients', element: <ClientsPage /> },
          { path: 'clients/:name', element: <ClientDetailPage /> },
          { path: 'routes', element: <RoutesPage /> },
          { path: 'usage', element: <UsagePage /> },
          { path: 'logs', element: <LogsPage /> },
          { path: 'config', element: <SystemConfigPage /> },
        ],
      },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
