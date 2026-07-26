import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { DialogPopupContainerContext } from './dialogPopupContainer'

interface PageDialogProps {
  title: string
  children: ReactNode
  footer: ReactNode
  className?: string
  onCancel: () => void
}

export function PageDialog({ title, children, footer, className = '', onCancel }: PageDialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [dialogElement, setDialogElement] = useState<HTMLDivElement | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const setDialogRef = useCallback((node: HTMLDivElement | null) => { dialogRef.current = node; setDialogElement(node) }, [])

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    firstFocusable?.focus()
    return () => previouslyFocusedRef.current?.focus()
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return <div className="provider-dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <div ref={setDialogRef} className={`provider-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
      <DialogPopupContainerContext.Provider value={dialogElement}>
        <h3 id={titleId} className="provider-dialog-title">{title}</h3>
        <div className="provider-dialog-content">{children}</div>
        <div className="provider-dialog-footer">{footer}</div>
      </DialogPopupContainerContext.Provider>
    </div>
  </div>
}
