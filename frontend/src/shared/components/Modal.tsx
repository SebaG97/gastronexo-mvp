// Mision 9.1: ventana reutilizable sobre <dialog> nativo (foco atrapado, Escape, fondo inerte).
// - variant="drawer": panel lateral en escritorio, pantalla completa en celular.
// - variant="dialog": ventana centrada en escritorio, hoja desde abajo en celular.
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

type ModalProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  /** Acciones fijas al pie (siempre visibles, tambien en celular). */
  footer?: ReactNode
  variant?: 'drawer' | 'dialog'
  size?: 'md' | 'lg'
  children: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, subtitle, footer, variant = 'dialog', size = 'md', children, className = '' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={ref}
      className={`modal modal--${variant} modal--${size} ${className}`.trim()}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // Click en el fondo (fuera de la caja) cierra.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal__box">
        <header className="modal__header">
          <div className="modal__titles">
            <h2 id={titleId} className="modal__title">{title}</h2>
            {subtitle ? <div className="modal__subtitle">{subtitle}</div> : null}
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Cerrar">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </dialog>
  )
}
