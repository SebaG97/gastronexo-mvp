import { useEffect, useState } from 'react'
import { Button, LoadErrorState, Panel, TableScroll } from '../../shared/components'
import { getSales, type Sale } from '../../shared/lib/auth-api'

const PAGE_SIZE = 10

const moneyFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

type SalesViewProps = {
  token: string
}

function formatMoney(value: string | number) {
  const numericValue = Number(value)
  return `Gs. ${moneyFormatter.format(Number.isFinite(numericValue) ? Math.round(numericValue) : 0)}`
}

function toLocalIsoDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function firstDayOfCurrentMonth() {
  const now = new Date()
  return toLocalIsoDate(new Date(now.getFullYear(), now.getMonth(), 1))
}

/** Inicio/fin del dia local, para filtrar por fecha de entrega. */
function localDayBoundary(isoDate: string, edge: 'start' | 'end') {
  return new Date(`${isoDate}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`).toISOString()
}

export function SalesView({ token }: SalesViewProps) {
  const [fromDate, setFromDate] = useState(firstDayOfCurrentMonth())
  const [toDate, setToDate] = useState(toLocalIsoDate(new Date()))
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [sales, setSales] = useState<Sale[]>([])
  const [summary, setSummary] = useState<{ count: number; total: string }>({ count: 0, total: '0' })
  const [totalPages, setTotalPages] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim())
      setPage(1)
    }, 350)

    return () => window.clearTimeout(timer)
  }, [searchTerm])

  async function loadSales() {
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await getSales(
        {
          from: fromDate ? localDayBoundary(fromDate, 'start') : undefined,
          to: toDate ? localDayBoundary(toDate, 'end') : undefined,
          q: debouncedSearchTerm || undefined,
          page,
          pageSize: PAGE_SIZE,
        },
        token,
      )
      setSales(response.sales)
      setSummary(response.summary)
      setTotalPages(response.pagination.totalPages)
    } catch {
      setLoadError('No se pudieron cargar las ventas.')
      setSales([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadSales()
  }, [debouncedSearchTerm, fromDate, page, toDate, token])

  return (
    <main className="page sales-page" aria-busy={isLoading}>
      <div className="page-header">
        <div>
          <h1>Ventas</h1>
          <p>Pedidos entregados en el período. Se registran al entregar un pedido.</p>
        </div>
      </div>

      {loadError ? null : (
        <section className="sales-summary" aria-label="Resumen del período">
          <article className="panel kpi-card">
            <p className="kpi-card__label">Total vendido</p>
            <strong className="kpi-card__value">{isLoading ? '…' : formatMoney(summary.total)}</strong>
            <span className="kpi-card__hint">Suma de pedidos entregados en el período</span>
          </article>
          <article className="panel kpi-card">
            <p className="kpi-card__label">Pedidos entregados</p>
            <strong className="kpi-card__value">{isLoading ? '…' : summary.count}</strong>
          </article>
        </section>
      )}

      <Panel title="Pedidos entregados">
        <div className="sales-filters">
          <label className="field stock-history__filter">
            Desde
            <input
              type="date"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.target.value)
                setPage(1)
              }}
            />
          </label>
          <label className="field stock-history__filter">
            Hasta
            <input
              type="date"
              value={toDate}
              onChange={(event) => {
                setToDate(event.target.value)
                setPage(1)
              }}
            />
          </label>
          <label className="field stock-history__filter">
            Buscar por número o cliente
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="PED-000001 o cliente"
            />
          </label>
        </div>

        {loadError ? <LoadErrorState message={loadError} onRetry={() => void loadSales()} isRetrying={isLoading} /> : null}
        {isLoading ? <p>Cargando ventas...</p> : null}
        {!isLoading && !loadError && sales.length === 0 ? (
          <p>No hay pedidos entregados en el período seleccionado.</p>
        ) : null}

        {!isLoading && sales.length > 0 ? (
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Entregado</th>
                  <th>Depósito</th>
                  <th className="numeric-cell">Items</th>
                  <th className="numeric-cell">Total</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td>{sale.orderNumber}</td>
                    <td>{sale.customerName}</td>
                    <td>{new Date(sale.deliveredAt).toLocaleString('es-PY')}</td>
                    <td>{sale.warehouseName ?? 'Sin depósito (previo a stock)'}</td>
                    <td className="numeric-cell">{sale.itemCount}</td>
                    <td className="numeric-cell">{formatMoney(sale.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : null}

        {loadError ? null : (
          <div className="products-pagination">
            <span>
              Página {page} de {Math.max(totalPages, 1)}
            </span>
            <div className="products-pagination__actions">
              <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                Anterior
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={totalPages === 0 || page >= totalPages}
                onClick={() => setPage((current) => current + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </main>
  )
}
