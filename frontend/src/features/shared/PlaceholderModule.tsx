import { CheckCircle2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Panel, StatusBadge } from '../../shared/components'

type PlaceholderModuleProps = {
  icon: LucideIcon
  title: string
  description: string
  itemLabel: string
}

export function PlaceholderModule({ icon: Icon, title, description, itemLabel }: PlaceholderModuleProps) {
  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <Panel className="placeholder-panel" title={`Gestión de ${title.toLowerCase()}`}>
        <div className="placeholder-panel__content">
          <Icon size={28} aria-hidden="true" />
          <p>Este módulo está preparado para conectar los flujos operativos de {itemLabel}.</p>
          <ul className="placeholder-list">
            <li>
              <CheckCircle2 size={16} aria-hidden="true" /> Vista de listado y filtros
            </li>
            <li>
              <CheckCircle2 size={16} aria-hidden="true" /> Alta y edición desde la acción principal
            </li>
            <li>
              <CheckCircle2 size={16} aria-hidden="true" /> Estado visible para seguimiento operativo
            </li>
          </ul>
          <StatusBadge>Base funcional lista</StatusBadge>
        </div>
      </Panel>
    </main>
  )
}
