import { createContext, useContext } from 'react'

export const DialogPopupContainerContext = createContext<HTMLElement | null>(null)

export function useDialogPopupContainer(): HTMLElement | null {
  return useContext(DialogPopupContainerContext)
}
