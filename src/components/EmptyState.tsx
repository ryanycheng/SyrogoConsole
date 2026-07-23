import type { ReactNode } from 'react'
import { Empty } from '@arco-design/web-react'

interface EmptyStateProps {
  description?: ReactNode
}

export function EmptyState({ description = 'No data' }: EmptyStateProps) {
  return <Empty className="empty-state" description={description} />
}
