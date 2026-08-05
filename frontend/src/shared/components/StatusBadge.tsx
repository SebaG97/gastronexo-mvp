import type { ReactNode } from 'react'

type StatusBadgeProps = {
  children: ReactNode
  tone?: 'success' | 'warning' | 'danger'
}

export function StatusBadge({ children, tone = 'success' }: StatusBadgeProps) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>
}
