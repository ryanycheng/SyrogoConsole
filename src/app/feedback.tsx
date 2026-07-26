import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Message } from '@arco-design/web-react'
import { FeedbackContext } from './feedbackContext'

interface FeedbackProviderProps {
  children: ReactNode
}

export function FeedbackProvider({ children }: FeedbackProviderProps) {
  const [message, holder] = Message.useMessage()
  const feedback = useMemo(() => ({
    success: (content: string) => { try { message.success?.(content) } catch { /* feedback must not change operation semantics */ } },
    error: (content: string) => { try { message.error?.(content) } catch { /* feedback must not change operation semantics */ } },
    warning: (content: string) => { try { message.warning?.(content) } catch { /* feedback must not change operation semantics */ } },
  }), [message])

  return <FeedbackContext.Provider value={feedback}>{holder}{children}</FeedbackContext.Provider>
}
