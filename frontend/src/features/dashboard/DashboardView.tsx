import { useCallback, useEffect, useState } from 'react'
import { LoadErrorState, Panel, TableScroll } from '../../shared/components'
import {
  getCustomers,
  getOrders,
  getProducts,
  getPurchases,
  type OrderStatus,
  type Purchase,
} from '../../shared/lib/auth-api'

type DashboardViewProps = {
  token: string
}

type DashboardData = {
  activeProducts: number
  activeCustomers: number
  ordersByStatus: Record<OrderStatus, number>
  purchasesThisMonth: number
  recentPurchases: Purchase[]
}

const orderStatuses: OrderStatus[] = ['new', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled']
const openOrderStatuses: OrderStatus[] = ['new', 'confirmed', 'preparing', 'ready']

const statusLabelByKey: Record<OrderStatus, string> = {
  new: 'Nuevo',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

const moneyFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

function formatMoney(value: string | number) {
  const numericValue = Number(value)
  return `Gs. ${moneyFormatter.format(Number.isFinite(numericValue) ? Math.round(numericValue) : 0)}`
}

function firstDayOfCurrentMonth() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${now.getFullYear()}-${month}-01`
}

async function loadDashboardData(token: string): Promise<DashboardData> {
  const [products, customers, purchasesThisMonth, recentPurchases, ...orderTotals] = await Promise.all([
    getProducts({ status: 'active', page: 1, pageSize: 1 }, token),
    getCustomers({ status: 'active', page: 1, pageSize: 1 }, token),
    getPurchases({ from: firstDayOfCurrentMonth(), page: 1, pageSize: 1 }, token),
    getPurchases({ page: 1, pageSize: 5 }, token),
    ...orderStatuses.map((status) => getOrders({ status, page: 1, pageSize: 1 }, token)),
  ])

  const ordersByStatus = Object.fromEntries(
    orderStatuses.map((status, index) => [status, orderTotals[index].pagination.total]),
  ) as Record<OrderStatus, number>

  return {
    activeProducts: products.pagination.total,
    activeCustomers: customers.pagination.total,
    ordersByStatus,
    purchasesThisMonth: purchasesThisMonth.pagination.total,
    recentPurchases: recentPurchases.purchases,
  }
}

export function DashboardView({ token }: DashboardViewProps) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      setData(await loadDashboardData(token))
    } catch {
      setData(null)
      setErrorMessage('No se pudo cargar el resumen operativo.')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const openOrders = data
    ? openOrderStatuses.reduce((total, status) => total + data.ordersByStatus[status], 0)
    : 0

  const kpis = data
    ? [
        { label: 'Productos activos', value: data.activeProducts },
        { label: 'Clientes activos', value: data.activeCustomers },
        { label: 'Pedidos abiertos', value: openOrders, hint: 'Nuevos, confirmados, en preparación o listos' },
        { label: 'Compras del mes', value: data.purchasesThisMonth },
      ]
    : []

  return (
    <main className="page" aria-busy={isLoading}>
      <div className="page-header">
        <div>
          <h1>Resumen operativo</h1>
          <p>Datos actuales de la organización activa.</p>
        </div>
      </div>

      {isLoading && !data ? <p>Cargando resumen...</p> : null}

      {errorMessage ? (
        <LoadErrorState message={errorMessage} onRetry={() => void loadData()} isRetrying={isLoading} />
      ) : null}

      {data ? (
        <>
          <section className="dashboard-grid dashboard-grid--compact" aria-label="Indicadores principales">
            {kpis.map((kpi) => (
              <article className="panel kpi-card" key={kpi.label}>
                <p className="kpi-card__label">{kpi.label}</p>
                <strong className="kpi-card__value">{kpi.value}</strong>
                {kpi.hint ? <span className="kpi-card__hint">{kpi.hint}</span> : null}
              </article>
            ))}
          </section>

          <section className="dashboard-content">
            <Panel title="Pedidos por estado">
              <ul className="dashboard-status-list">
                {orderStatuses.map((status) => (
                  <li key={status}>
                    <span>{statusLabelByKey[status]}</span>
                    <strong>{data.ordersByStatus[status]}</strong>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Compras recientes">
              {data.recentPurchases.length === 0 ? (
                <p>Sin compras registradas todavía.</p>
              ) : (
                <TableScroll>
                  <table className="products-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Proveedor</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentPurchases.map((purchase) => (
                        <tr key={purchase.id}>
                          <td>{new Date(purchase.purchaseDate).toLocaleDateString('es-PY')}</td>
                          <td>{purchase.supplierName}</td>
                          <td>{formatMoney(purchase.totalAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </Panel>
            <Panel className="alerts-panel" title="Facturación, mermas y alertas">
              <p className="dashboard-empty">
                Sin datos todavía. Estos indicadores se mostrarán cuando estén disponibles los módulos de
                ventas, mermas y producción.
              </p>
            </Panel>
          </section>
        </>
      ) : null}
    </main>
  )
}
