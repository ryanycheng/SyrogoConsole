import { Navigate, Outlet, RouterProvider, createBrowserRouter } from 'react-router-dom'
import { hasAdminToken } from '../api/auth'
import { AppLayout } from './AppLayout'
import { LoginPage } from '../pages/login/LoginPage'
import { DashboardPage } from '../pages/dashboard/DashboardPage'
import { UsagePage } from '../pages/usage/UsagePage'
import { LogsPage } from '../pages/logs/LogsPage'
import { SessionsPage } from '../pages/sessions/SessionsPage'
import { ProvidersPage } from '../pages/providers/ProvidersPage'

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
          { path: 'usage', element: <UsagePage /> },
          { path: 'logs', element: <LogsPage /> },
        ],
      },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
