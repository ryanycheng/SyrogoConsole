import { createContext, useContext } from 'react'

export interface Feedback {
  success: (content: string) => void
  error: (content: string) => void
  warning: (content: string) => void
}

export const FeedbackContext = createContext<Feedback | null>(null)

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext)
  if (!feedback) throw new Error('useFeedback must be used within FeedbackProvider')
  return feedback
}
