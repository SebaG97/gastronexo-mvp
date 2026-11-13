import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, LoadErrorState, Panel, StatusBadge, TableScroll } from '../../shared/components'
import {
  ApiError,
  createWasteRecord,
  getInventoryBalances,
  getWarehouses,
  getWasteRecords,
  voidWasteRecord,
  type InventoryBalance,
  type Warehouse,
  type WasteListResponse,
  type WasteReason,
  type WasteRecord,
} from '../../shared/lib/auth-api'

// Mision 8.3: mermas (perdidas de stock) con su impacto economico.

type WasteViewProps = {
  token: string
  canWrite: boolean
  createRequestId: number
}

const PAGE_SIZE = 15

export const wasteReasonLabels: Record<WasteReason, string> = {
  expired: 'Vencido o deteriorado',
  damaged: 'Roto o dañado',
  preparation: 'Recorte de preparación',
  missing: 'Faltante o robo',
  other: 'Otro',
}

const unitLabels: Record<string, string> = { kg: 'kg', g: 'g', l: 'l', ml: 'ml', unit: 'u.', box: 'cajas', portion: 'porciones' }
const wholeUnits = new Set(['unit', 'box', 'portion'])

const quantityFormatter = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 3 })
const moneyFormatter = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 })
const dateFormatter = new Intl.DateTimeFormat('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })

const formatMoney = (value: string | number) => `Gs. ${moneyFormatter.format(Math.round(Number(value)))}`
const formatQuantity = (value: string | number, unit: string) => `${quantityFormatter.format(Number(value))} ${unitLabels[unit] ?? unit}`
const formatDate = (iso: string) => dateFormatter.format(new Date(`${iso}T00:00:00Z`))

function localIsoDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

type Period = 'month' | 'last-month' | '7d' | 'all'
const periodLabels: Record<Period, string> = { month: 'Este mes', 'last-month': 'Mes pasado', '7d': 'Últimos 7 días', all: 'Todo' }

function periodRange(period: Period): { from?: string; to?: string } {
  const today = new Date()
  if (period === 'month') return { from: localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: localIsoDate(today) }
  if (period === 'last-month') {
    return {
      from: localIsoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: localIsoDate(new Date(today.getFullYear(), today.getMonth(), 0)),
    }
  }
  if (period === '7d') return { from: localIsoDate(new Date(today.getTime() - 6 * 86_400_000)), to: localIsoDate(today) }
  return {}
}

type FormState = { warehouseId: string; productId: string; quantity: string; reason: WasteReason; notes: string; occurredOn: string }

export function WasteView({ token, canWrite, createRequestId }: WasteViewProps) {
  const [period, setPeriod] = useState<Period>('month')
  const [reasonFilter, setReasonFilter] = useState<WasteReason | ''>('')
  const [statusFilter, setStatusFilter] = useState<'completed' | 'voided' | 'all'>('completed')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<WasteListResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [balances, setBalances] = useState<InventoryBalance[]>([])
  const [form, setForm] = useState<FormState>({ warehouseId: '', productId: '', quantity: '', reason: 'expired', notes: '', occurredOn: localIsoDate() })
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const [voiding, setVoiding] = useState<WasteRecord | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidError, setVoidError] = useState<string | null>(null)

  async function load() {
    setIsLoading(true)
    setLoadError(null)
    try {
      setData(
        await getWasteRecords(
          { ...periodRange(period), reason: reasonFilter || undefined, status: statusFilter, page, pageSize: PAGE_SIZE },
          token,
        ),
      )
    } catch {
      setLoadError('No se pudieron cargar las mermas.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, period, reasonFilter, statusFilter, page])

  async function loadBalances(warehouseId: string) {
    if (!warehouseId) {
      setBalances([])
      return
    }
    try {
      const response = await getInventoryBalances({ warehouseId, page: 1, pageSize: 100 }, token)
      setBalances(response.balances.filter((balance) => Number(balance.availableQuantity) > 0))
    } catch {
      setFormError('No se pudo cargar el stock del depósito.')
    }
  }

  async function openForm() {
    setIsFormOpen(true)
    setFormError(null)
    setSuccessMessage(null)
    try {
      const response = await getWarehouses('active', token)
      setWarehouses(response.warehouses)
      const warehouseId = form.warehouseId || response.warehouses[0]?.id || ''
      setForm((current) => ({ ...current, warehouseId }))
      await loadBalances(warehouseId)
    } catch {
      setFormError('No se pudieron cargar los depósitos.')
    }
  }

  useEffect(() => {
    if (createRequestId > 0 && canWrite) void openForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequestId, canWrite])

  const selected = useMemo(() => balances.find((balance) => balance.productId === form.productId) ?? null, [balances, form.productId])
  const quantityNumber = Number(form.quantity.replace(',', '.'))
  const estimatedCost = selected && quantityNumber > 0 ? quantityNumber * Number(selected.cost) : 0

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setFormError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSuccessMessage(null)
    if (!form.warehouseId) return setFormError('Elegí un depósito.')
    if (!selected) return setFormError('Elegí un producto con stock disponible.')
    if (!(quantityNumber > 0)) return setFormError('Escribí una cantidad mayor a 0.')
    if (wholeUnits.has(selected.unit) && !Number.isInteger(quantityNumber)) {
      return setFormError(`${selected.productName} se cuenta por unidades: usá una cantidad entera.`)
    }
    if (quantityNumber > Number(selected.availableQuantity)) {
      return setFormError(`Hay ${formatQuantity(selected.availableQuantity, selected.unit)} disponibles (lo reservado por pedidos no se puede dar de baja).`)
    }
    if (form.reason === 'other' && !form.notes.trim()) return setFormError('Contá qué pasó cuando el motivo es "Otro".')

    setIsSaving(true)
    try {
      const { wasteRecord } = await createWasteRecord(
        {
          warehouseId: form.warehouseId,
          productId: form.productId,
          quantity: quantityNumber,
          reason: form.reason,
          notes: form.notes.trim() || null,
          occurredOn: form.occurredOn,
        },
        token,
      )
      setSuccessMessage(
        `${wasteRecord.wasteNumber}: ${formatQuantity(wasteRecord.quantity, wasteRecord.productUnit)} de ${wasteRecord.productName} dados de baja (${formatMoney(wasteRecord.totalCost)}).`,
      )
      // Queda abierto para cargar la siguiente: se limpia producto, cantidad y notas.
      setForm((current) => ({ ...current, productId: '', quantity: '', notes: '' }))
      await Promise.all([loadBalances(form.warehouseId), load()])
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'No se pudo registrar la merma.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleVoid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!voiding) return
    if (voidReason.trim().length < 3) return setVoidError('Contá brevemente por qué se anula.')
    try {
      const { wasteRecord } = await voidWasteRecord(voiding.id, voidReason.trim(), token)
      setSuccessMessage(`${wasteRecord.wasteNumber} anulada: el stock volvió al depósito.`)
      setVoiding(null)
      setVoidReason('')
      await Promise.all([load(), isFormOpen ? loadBalances(form.warehouseId) : Promise.resolve()])
    } catch (error) {
      setVoidError(error instanceof ApiError ? error.message : 'No se pudo anular.')
    }
  }

  const summary = data?.summary
  const maxReasonCost = Math.max(1, ...(summary?.byReason.map((row) => Number(row.totalCost)) ?? [1]))

  return (
    <main className="page waste-page" aria-busy={isLoading}>
      <div className="page-header">
        <div>
          <h1>Mermas</h1>
          <p>Registrá lo que se pierde (vencido, roto, recortes, faltantes) y medí cuánto cuesta.</p>
        </div>
      </div>

      {successMessage ? (
        <p className="members-message members-message--success" role="status" aria-live="polite">
          {successMessage}
        </p>
      ) : null}

      {canWrite && isFormOpen ? (
        <Panel
          title="Registrar merma"
          action={
            <Button type="button" variant="secondary" onClick={() => setIsFormOpen(false)}>
              Cerrar
            </Button>
          }
        >
          <form className="waste-form" onSubmit={handleSubmit} noValidate>
            <label className="field">
              Depósito
              <select
                className="select-input"
                value={form.warehouseId}
                onChange={(event) => {
                  update('warehouseId', event.target.value)
                  update('productId', '')
                  void loadBalances(event.target.value)
                }}
              >
                {warehouses.length === 0 ? <option value="">Sin depósitos activos</option> : null}
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field waste-form__product">
              Producto
              <select className="select-input" value={form.productId} onChange={(event) => update('productId', event.target.value)}>
                <option value="">{balances.length === 0 ? 'Sin stock disponible en este depósito' : 'Elegí un producto'}</option>
                {balances.map((balance) => (
                  <option key={balance.productId} value={balance.productId}>
                    {balance.productName} · {formatQuantity(balance.availableQuantity, balance.unit)} disponibles
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Cantidad{selected ? ` (${unitLabels[selected.unit] ?? selected.unit})` : ''}
              <input
                inputMode="decimal"
                value={form.quantity}
                onChange={(event) => update('quantity', event.target.value.replace(/[^0-9.,]/g, ''))}
                placeholder={selected && wholeUnits.has(selected.unit) ? '1' : '0,5'}
              />
            </label>
            <label className="field">
              Motivo
              <select className="select-input" value={form.reason} onChange={(event) => update('reason', event.target.value as WasteReason)}>
                {Object.entries(wasteReasonLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Fecha
              <input type="date" value={form.occurredOn} max={localIsoDate()} onChange={(event) => update('occurredOn', event.target.value)} />
            </label>
            <label className="field waste-form__wide">
              Notas{form.reason === 'other' ? ' (obligatorias)' : ' (opcional)'}
              <input value={form.notes} maxLength={500} onChange={(event) => update('notes', event.target.value)} placeholder="Ej.: cajón golpeado en la descarga" />
            </label>
            <div className="waste-form__footer waste-form__wide">
              <p className="waste-form__estimate" aria-live="polite">
                {selected ? (
                  <>
                    Costo estimado: <strong>{formatMoney(estimatedCost)}</strong> · costo actual {formatMoney(selected.cost)} por{' '}
                    {unitLabels[selected.unit] ?? selected.unit}
                  </>
                ) : (
                  'Solo se puede dar de baja stock disponible: lo reservado por pedidos no se toca.'
                )}
              </p>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Registrando...' : 'Registrar merma'}
              </Button>
            </div>
            {formError ? (
              <p className="members-message members-message--error waste-form__wide" role="alert">
                {formError}
              </p>
            ) : null}
          </form>
        </Panel>
      ) : null}

      <section className="waste-summary" aria-label="Resumen del período">
        <div className="waste-summary__card">
          <span>Costo de mermas · {periodLabels[period].toLowerCase()}</span>
          <strong>{summary ? formatMoney(summary.totalCost) : '—'}</strong>
          <small>{summary ? `${summary.count} ${summary.count === 1 ? 'registro vigente' : 'registros vigentes'}` : ''}</small>
        </div>
        <div className="waste-summary__card waste-summary__reasons">
          <span>Por motivo</span>
          {summary && summary.byReason.length > 0 ? (
            <ul>
              {summary.byReason.map((row) => (
                <li key={row.reason}>
                  <span className="waste-summary__label">{wasteReasonLabels[row.reason]}</span>
                  <span className="waste-summary__bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(4, (Number(row.totalCost) / maxReasonCost) * 100)}%` }} />
                  </span>
                  <span className="waste-summary__value">{formatMoney(row.totalCost)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <small>Sin mermas en el período.</small>
          )}
        </div>
      </section>

      <Panel title="Registro de mermas" action={<span>Total: {data?.pagination.total ?? 0}</span>}>
        <div className="waste-filters">
          <label className="field">
            Período
            <select className="select-input" value={period} onChange={(event) => { setPeriod(event.target.value as Period); setPage(1) }}>
              {Object.entries(periodLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Motivo
            <select className="select-input" value={reasonFilter} onChange={(event) => { setReasonFilter(event.target.value as WasteReason | ''); setPage(1) }}>
              <option value="">Todos</option>
              {Object.entries(wasteReasonLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Estado
            <select className="select-input" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1) }}>
              <option value="completed">Vigentes</option>
              <option value="voided">Anuladas</option>
              <option value="all">Todas</option>
            </select>
          </label>
        </div>

        {loadError ? <LoadErrorState message={loadError} onRetry={() => void load()} isRetrying={isLoading} /> : null}

        {!loadError && data && data.wasteRecords.length === 0 ? (
          <p className="waste-empty">
            No hay mermas {statusFilter === 'voided' ? 'anuladas ' : ''}en este período.
            {canWrite ? ' Usá "Registrar merma" para cargar la primera.' : ''}
          </p>
        ) : null}

        {data && data.wasteRecords.length > 0 ? (
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Motivo</th>
                  <th>Costo</th>
                  <th>Depósito</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {data.wasteRecords.map((record) => (
                  <tr key={record.id} className={record.status === 'voided' ? 'waste-row--voided' : undefined}>
                    <td>{record.wasteNumber}</td>
                    <td>{formatDate(record.occurredOn)}</td>
                    <td>
                      {record.productName}
                      {record.notes ? <small className="waste-row__notes">{record.notes}</small> : null}
                    </td>
                    <td>{formatQuantity(record.quantity, record.productUnit)}</td>
                    <td>{wasteReasonLabels[record.reason]}</td>
                    <td>{formatMoney(record.totalCost)}</td>
                    <td>{record.warehouseName}</td>
                    <td>
                      <StatusBadge tone={record.status === 'voided' ? 'warning' : 'danger'}>
                        {record.status === 'voided' ? 'Anulada' : 'Vigente'}
                      </StatusBadge>
                      {record.status === 'voided' && record.voidReason ? <small className="waste-row__notes">{record.voidReason}</small> : null}
                    </td>
                    <td>
                      {canWrite && record.status === 'completed' ? (
                        <Button type="button" variant="secondary" onClick={() => { setVoiding(record); setVoidReason(''); setVoidError(null) }}>
                          Anular
                        </Button>
                      ) : (
                        <span className="products-table__no-actions">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : null}

        {data && data.pagination.totalPages > 1 ? (
          <div className="products-pagination">
            <span>
              Página {data.pagination.page} de {data.pagination.totalPages}
            </span>
            <div className="products-pagination__actions">
              <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                Anterior
              </Button>
              <Button type="button" variant="secondary" disabled={page >= data.pagination.totalPages} onClick={() => setPage((current) => current + 1)}>
                Siguiente
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      {voiding ? (
        <Panel title={`Anular ${voiding.wasteNumber}`}>
          <form className="waste-void" onSubmit={handleVoid} noValidate>
            <p>
              Vuelven al depósito {formatQuantity(voiding.quantity, voiding.productUnit)} de {voiding.productName}. El registro queda en el
              historial como anulado.
            </p>
            <label className="field">
              Motivo de la anulación
              <input value={voidReason} autoFocus maxLength={300} onChange={(event) => { setVoidReason(event.target.value); setVoidError(null) }} placeholder="Ej.: se cargó dos veces" />
            </label>
            {voidError ? (
              <p className="members-message members-message--error" role="alert">
                {voidError}
              </p>
            ) : null}
            <div className="products-form__actions">
              <Button type="button" variant="secondary" onClick={() => setVoiding(null)}>
                Volver
              </Button>
              <Button type="submit">Anular merma</Button>
            </div>
          </form>
        </Panel>
      ) : null}
    </main>
  )
}
