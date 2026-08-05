import { Activity, AlertTriangle, Clock3, PackageX } from 'lucide-react'
import { Panel, StatusBadge } from '../../shared/components'

const kpis = [
  { label: 'Facturación día', value: '$ 248.500', trend: '+8,4% vs. ayer' },
  { label: 'Facturación semana', value: '$ 1.642.800', trend: '+5,1% vs. semana anterior' },
  { label: 'Facturación mes', value: '$ 6.384.250', trend: '+12,3% vs. mes anterior' },
  { label: 'Compras mes', value: '$ 2.105.640', trend: '32,9% de facturación' },
  { label: 'Costo de merma', value: '$ 86.700', trend: '1,4% de facturación' },
  { label: 'Margen estimado', value: '34,8%', trend: '+1,2 pts. este mes' },
]

const alerts = [
  {
    icon: PackageX,
    title: 'Stock bajo',
    detail: '6 insumos alcanzaron su punto de reposición.',
    tone: 'warning' as const,
    label: 'Revisar',
  },
  {
    icon: Clock3,
    title: 'Próximo a vencer',
    detail: '3 lotes vencen dentro de los próximos 3 días.',
    tone: 'danger' as const,
    label: 'Prioridad',
  },
  {
    icon: AlertTriangle,
    title: 'Sin movimiento',
    detail: '8 productos no registran actividad en 30 días.',
    tone: 'warning' as const,
    label: 'Atención',
  },
]

export function DashboardView() {
  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h1>Resumen operativo</h1>
          <p>Indicadores principales del negocio para hoy.</p>
        </div>
      </div>

      <section className="dashboard-grid" aria-label="Indicadores principales">
        {kpis.map((kpi) => (
          <article className="panel kpi-card" key={kpi.label}>
            <p className="kpi-card__label">{kpi.label}</p>
            <strong className="kpi-card__value">{kpi.value}</strong>
            <span className="kpi-card__trend">{kpi.trend}</span>
          </article>
        ))}
      </section>

      <section className="dashboard-content">
        <Panel title="Facturación y compras">
          <div className="chart-placeholder">
            <Activity size={20} aria-hidden="true" />
            <span>Gráfico de evolución mensual</span>
          </div>
        </Panel>
        <Panel title="Composición de costos">
          <div className="chart-placeholder">
            <Activity size={20} aria-hidden="true" />
            <span>Gráfico de distribución de costos</span>
          </div>
        </Panel>
        <Panel className="alerts-panel" title="Alertas operativas">
          <div className="alert-list">
            {alerts.map(({ icon: Icon, title, detail, tone, label }) => (
              <article className="alert-row" key={title}>
                <div>
                  <strong>
                    <Icon size={16} aria-hidden="true" /> {title}
                  </strong>
                  <p className="alert-row__detail">{detail}</p>
                </div>
                <StatusBadge tone={tone}>{label}</StatusBadge>
              </article>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  )
}
