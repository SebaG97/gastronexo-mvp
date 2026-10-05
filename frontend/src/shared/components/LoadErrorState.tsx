import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

type LoadErrorStateProps = {
  message: string
  onRetry: () => void
  isRetrying?: boolean
}

export function LoadErrorState({ message, onRetry, isRetrying = false }: LoadErrorStateProps) {
  return (
    <div className="load-error" role="alert" aria-live="polite">
      <AlertTriangle size={18} aria-hidden="true" />
      <p className="load-error__message">{message}</p>
      <Button type="button" variant="secondary" onClick={onRetry} disabled={isRetrying}>
        {isRetrying ? 'Reintentando...' : 'Reintentar'}
      </Button>
    </div>
  )
}
