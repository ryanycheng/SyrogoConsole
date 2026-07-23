import type { ReactNode } from 'react'
import { Space, Typography } from '@arco-design/web-react'

interface PageHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div>
        <Typography.Title heading={3}>{title}</Typography.Title>
        {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
      </div>
      {actions ? <Space>{actions}</Space> : null}
    </div>
  )
}
