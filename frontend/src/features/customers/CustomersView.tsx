import { useEffect, useState } from 'react'
import { Button, LoadErrorState, Panel, StatusBadge, TableScroll } from '../../shared/components'
import {
  ApiError,
  createCustomer,
  getCustomers,
  updateCustomer,
  updateCustomerStatus,
  type Customer,
  type CustomerMutationInput,
  type CustomersStatusFilter,
} from '../../shared/lib/auth-api'

const PAGE_SIZE = 10

type CustomersViewProps = {
  token: string
  canWriteCustomers: boolean
  createRequestId: number
}

type CustomerForm = {
  name: string
  businessName: string
  documentNumber: string
  phone: string
  email: string
  notes: string
}

type FormMode =
  | { type: 'closed' }
  | { type: 'create' }
  | { type: 'edit'; customer: Customer }

const defaultCustomerForm: CustomerForm = {
  name: '',
  businessName: '',
  documentNumber: '',
  phone: '',
  email: '',
  notes: '',
}

function emptyToNull(value: string) {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function customerToForm(customer: Customer): CustomerForm {
  return {
    name: customer.name,
    businessName: customer.businessName ?? '',
    documentNumber: customer.documentNumber ?? '',
    phone: customer.phone ?? '',
    email: customer.email ?? '',
    notes: customer.notes ?? '',
  }
}

function formToPayload(form: CustomerForm): CustomerMutationInput {
  return {
    name: form.name.trim(),
    businessName: emptyToNull(form.businessName),
    documentNumber: emptyToNull(form.documentNumber),
    phone: emptyToNull(form.phone),
    email: emptyToNull(form.email),
    notes: emptyToNull(form.notes),
  }
}

export function CustomersView({ token, canWriteCustomers, createRequestId }: CustomersViewProps) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [status, setStatus] = useState<CustomersStatusFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [formMode, setFormMode] = useState<FormMode>({ type: 'closed' })
  const [form, setForm] = useState<CustomerForm>(defaultCustomerForm)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingCustomerId, setPendingCustomerId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim())
      setPage(1)
    }, 350)

    return () => window.clearTimeout(timer)
  }, [searchTerm])

  useEffect(() => {
    if (createRequestId > 0 && canWriteCustomers) {
      setFormMode({ type: 'create' })
      setForm(defaultCustomerForm)
      setErrorMessage(null)
      setSuccessMessage(null)
    }
  }, [canWriteCustomers, createRequestId])

  async function loadCustomers() {
    setIsLoading(true)
    setLoadError(null)

    try {
      const response = await getCustomers(
        {
          q: debouncedSearchTerm || undefined,
          status,
          page,
          pageSize: PAGE_SIZE,
        },
        token,
      )
      setCustomers(response.customers)
      setTotal(response.pagination.total)
      setTotalPages(response.pagination.totalPages)
    } catch {
      setLoadError('No se pudieron cargar los clientes.')
      setCustomers([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadCustomers()
  }, [debouncedSearchTerm, page, status, token])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.name.trim()) {
      setErrorMessage('El nombre del cliente es obligatorio.')
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      if (formMode.type === 'edit') {
        await updateCustomer(formMode.customer.id, formToPayload(form), token)
        setSuccessMessage('Cliente actualizado correctamente.')
      } else {
        await createCustomer(formToPayload(form), token)
        setSuccessMessage('Cliente creado correctamente.')
      }

      setFormMode({ type: 'closed' })
      setForm(defaultCustomerForm)
      await loadCustomers()
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo guardar el cliente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleToggleStatus(customer: Customer) {
    const nextStatus = !customer.isActive
    const actionLabel = nextStatus ? 'activar' : 'inactivar'

    if (!window.confirm(`Confirmas ${actionLabel} este cliente?`)) {
      return
    }

    setPendingCustomerId(customer.id)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      await updateCustomerStatus(customer.id, nextStatus, token)
      setSuccessMessage(nextStatus ? 'Cliente activado correctamente.' : 'Cliente inactivado correctamente.')
      await loadCustomers()
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo actualizar el cliente.')
    } finally {
      setPendingCustomerId(null)
    }
  }

  return (
    <main className="page customers-page" aria-busy={isLoading}>
      <div className="page-header">
        <div>
          <h1>Clientes</h1>
          <p>Gestiona clientes basicos para pedidos administrativos.</p>
        </div>
      </div>

      {formMode.type !== 'closed' && canWriteCustomers ? (
        <Panel className="customers-panel" title={formMode.type === 'edit' ? 'Editar cliente' : 'Nuevo cliente'}>
          <form className="customer-form" onSubmit={handleSubmit}>
            <label className="field">
              Nombre
              <input value={form.name} maxLength={160} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label className="field">
              Razon social
              <input value={form.businessName} maxLength={160} onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))} />
            </label>
            <label className="field">
              Documento
              <input value={form.documentNumber} maxLength={80} onChange={(event) => setForm((current) => ({ ...current, documentNumber: event.target.value }))} />
            </label>
            <label className="field">
              Telefono
              <input type="tel" value={form.phone} maxLength={80} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </label>
            <label className="field">
              Email
              <input type="email" value={form.email} maxLength={160} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label className="field customer-form__notes">
              Notas
              <input value={form.notes} maxLength={600} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <div className="products-form__actions">
              <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Guardando...' : 'Guardar cliente'}</Button>
              <Button type="button" variant="secondary" onClick={() => setFormMode({ type: 'closed' })}>Cancelar</Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel className="customers-panel" title="Directorio" action={loadError ? undefined : <span>Total: {total}</span>}>
        <div className="products-toolbar">
          <label className="field products-toolbar__field">
            Buscar cliente
            <input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Nombre, razon social o documento" />
          </label>
          <label className="field products-toolbar__field products-toolbar__field--compact">
            Estado
            <select className="select-input" value={status} onChange={(event) => { setStatus(event.target.value as CustomersStatusFilter); setPage(1) }}>
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </label>
        </div>

        {loadError ? <LoadErrorState message={loadError} onRetry={() => void loadCustomers()} isRetrying={isLoading} /> : null}
        {isLoading ? <p>Cargando clientes...</p> : null}
        {!isLoading && !loadError && customers.length === 0 ? <p>No hay clientes para los filtros seleccionados.</p> : null}

        {!isLoading && customers.length > 0 ? (
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Razon social</th>
                  <th>Documento</th>
                  <th>Contacto</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>{customer.name}</td>
                    <td>{customer.businessName ?? 'Sin dato'}</td>
                    <td>{customer.documentNumber ?? 'Sin dato'}</td>
                    <td>{customer.phone ?? customer.email ?? 'Sin dato'}</td>
                    <td><StatusBadge tone={customer.isActive ? 'success' : 'warning'}>{customer.isActive ? 'Activo' : 'Inactivo'}</StatusBadge></td>
                    <td className="products-table__actions">
                      {canWriteCustomers ? (
                        <>
                          <Button type="button" variant="secondary" disabled={pendingCustomerId === customer.id} onClick={() => { setFormMode({ type: 'edit', customer }); setForm(customerToForm(customer)) }}>Editar</Button>
                          <Button type="button" variant="secondary" disabled={pendingCustomerId === customer.id} onClick={() => void handleToggleStatus(customer)}>{customer.isActive ? 'Inactivar' : 'Activar'}</Button>
                        </>
                      ) : (
                        <span className="products-table__no-actions">Solo lectura</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : null}

        {loadError ? null : (
          <div className="products-pagination">
            <span>Pagina {page} de {Math.max(totalPages, 1)}</span>
            <div className="products-pagination__actions">
              <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
              <Button type="button" variant="secondary" disabled={totalPages === 0 || page >= totalPages} onClick={() => setPage((current) => current + 1)}>Siguiente</Button>
            </div>
          </div>
        )}
      </Panel>

      {errorMessage ? <p className="members-message members-message--error" role="alert" aria-live="polite">{errorMessage}</p> : null}
      {successMessage ? <p className="members-message members-message--success" role="status" aria-live="polite">{successMessage}</p> : null}
    </main>
  )
}
