import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Input, Space, Typography } from '@arco-design/web-react'
import { IconLock } from '@arco-design/web-react/icon'
import { apiGet } from '../../api/client'
import { setAdminToken } from '../../api/auth'

export function LoginPage() {
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = token.trim()
    if (!value) {
      setError('Admin token is required')
      return
    }
    setLoading(true)
    setError('')
    setAdminToken(value)
    try {
      await apiGet('/admin/overview')
      navigate('/dashboard', { replace: true })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <Card className="login-card" bordered={false}>
        <div className="login-brand">
          <div className="brand-mark">S</div>
          <div>
            <Typography.Title heading={3}>Syrogo Console</Typography.Title>
            <Typography.Text type="secondary">Connect to a Syrogo Admin API endpoint.</Typography.Text>
          </div>
        </div>
        <form onSubmit={submit} className="login-form">
          <Input.Password
            prefix={<IconLock />}
            size="large"
            value={token}
            onChange={setToken}
            placeholder="Admin UI token"
            autoFocus
          />
          {error ? <Typography.Text type="error">{error}</Typography.Text> : null}
          <Space direction="vertical" size={10} className="full-width">
            <Button long type="primary" htmlType="submit" loading={loading}>
              Sign in
            </Button>
            <Typography.Text type="secondary">The token is stored only in this browser.</Typography.Text>
          </Space>
        </form>
      </Card>
    </main>
  )
}
