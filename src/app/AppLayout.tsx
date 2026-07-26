import { useMemo } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Button, Layout, Menu, Space, Typography } from '@arco-design/web-react'
import {
  IconBug,
  IconCode,
  IconCommon,
  IconDashboard,
  IconFile,
  IconHistory,
  IconPoweroff,
  IconSafe,
  IconSettings,
  IconStorage,
} from '@arco-design/web-react/icon'
import { clearAdminToken } from '../api/auth'

const { Header, Sider, Content } = Layout

const navItems = [
  { key: '/dashboard', label: 'Dashboard', icon: <IconDashboard /> },
  { key: '/sessions', label: 'Sessions', icon: <IconHistory /> },
  { key: '/providers', label: 'Providers', icon: <IconStorage /> },
  { key: '/clients', label: 'Clients', icon: <IconSafe /> },
  { key: '/routes', label: 'Routes', icon: <IconCommon /> },
  { key: '/usage', label: 'Usage', icon: <IconDashboard /> },
  { key: '/monitoring', label: 'Monitoring', icon: <IconCode />, disabled: true },
  { key: '/logs', label: 'Logs', icon: <IconFile /> },
  { key: '/config', label: 'System Config', icon: <IconSettings /> },
  { key: '/debug', label: 'Debug', icon: <IconBug />, disabled: true },
]

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const selectedKey = useMemo(() => {
    const match = navItems.find((item) => location.pathname.startsWith(item.key))
    return match?.key || '/dashboard'
  }, [location.pathname])

  function logout() {
    clearAdminToken()
    navigate('/login', { replace: true })
  }

  return (
    <Layout className="app-shell">
      <Sider className="app-sider" width={236}>
        <div className="brand-block">
          <div className="brand-mark">S</div>
          <div>
            <Typography.Title heading={5}>Syrogo</Typography.Title>
            <Typography.Text type="secondary">Console</Typography.Text>
          </div>
        </div>
        <Menu selectedKeys={[selectedKey]} onClickMenuItem={(key) => navigate(key)}>
          {navItems.map((item) => (
            <Menu.Item key={item.key} disabled={item.disabled}>
              <Space size={8}>
                {item.icon}
                <span>{item.label}</span>
              </Space>
            </Menu.Item>
          ))}
        </Menu>
      </Sider>
      <Layout>
        <Header className="app-header">
          <div>
            <Typography.Text type="secondary">Syrogo Admin API</Typography.Text>
            <Typography.Title heading={4}>Management Console</Typography.Title>
          </div>
          <Button icon={<IconPoweroff />} onClick={logout}>
            Logout
          </Button>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
