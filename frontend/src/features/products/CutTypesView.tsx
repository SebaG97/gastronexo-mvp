import { useEffect, useMemo, useState } from 'react'
import { Button, Panel, StatusBadge, TableScroll } from '../../shared/components'
import {
  ApiError,
  createCutType,
  getCutTypes,
  updateCutType,
  updateCutTypeStatus,
  type CutType,
  type CutTypesStatusFilter,
} from '../../shared/lib/auth-api'

type CutTypesViewProps = {
  token: string
  canWriteProducts: boolean
  createRequestId: number
}

type FormState =
  | { type: 'closed' }
  | { type: 'create'; values: CutTypeFormValues }
  | { type: 'edit'; cutType: CutType; values: CutTypeFormValues }

type CutTypeFormValues = {
  name: string
  description: string
}

const emptyValues: CutTypeFormValues = {
  name: '',
  description: '',
}

function toValues(cutType: CutType): CutTypeFormValues {
  return {
    name: cutType.name,
    description: cutType.description ?? '',
  }
}

export function CutTypesView({ token, canWriteProducts, createRequestId }: CutTypesViewProps) {
  const [cutTypes, setCutTypes] = useState<CutType[]>([])
  const [status, setStatus] = useState<CutTypesStatusFilter>('active')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [formState, setFormState] = useState<FormState>({ type: 'closed' })
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const canShowEmptyState = useMemo(
    () => !isLoading && cutTypes.length === 0 && !errorMessage,
    [cutTypes.length, errorMessage, isLoading],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim())
    }, 300)

    return () => window.clearTimeout(timer)
  }, [searchTerm])

  useEffect(() => {
    if (createRequestId > 0 && canWriteProducts) {
      setFormState({ type: 'create', values: emptyValues })
      setFieldError(null)
      setErrorMessage(null)
      setSuccessMessage(null)
    }
  }, [canWriteProducts, createRequestId])

  async function loadCutTypes() {
    setErrorMessage(null)
    setIsLoading(true)

    try {
      const response = await getCutTypes(
        { q: debouncedSearchTerm || undefined, status },
        token,
      )
      setCutTypes(response.cutTypes)
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudieron cargar los tipos de corte.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadCutTypes()
  }, [debouncedSearchTerm, status, token])

  function updateForm(field: keyof CutTypeFormValues, value: string) {
    setFieldError(null)
    setFormState((current) => {
      if (current.type === 'closed') {
        return current
      }

      return { ...current, values: { ...current.values, [field]: value } }
    })
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (formState.type === 'closed') {
      return
    }

    const name = formState.values.name.trim()
    const description = formState.values.description.trim()

    if (!name) {
      setFieldError('El nombre es obligatorio.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      if (formState.type === 'create') {
        await createCutType({ name, description: description || null }, token)
        setSuccessMessage('Tipo de corte creado correctamente.')
      } else {
        await updateCutType(formState.cutType.id, { name, description: description || null }, token)
        setSuccessMessage('Tipo de corte actualizado correctamente.')
      }

      setFormState({ type: 'closed' })
      await loadCutTypes()
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo guardar el tipo de corte.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleToggleStatus(cutType: CutType) {
    const nextStatus = !cutType.isActive
    const actionLabel = nextStatus ? 'activar' : 'inactivar'

    if (!window.confirm(`Confirmas ${actionLabel} este tipo de corte?`)) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setPendingId(cutType.id)

    try {
      await updateCutTypeStatus(cutType.id, nextStatus, token)
      setSuccessMessage(nextStatus ? 'Tipo de corte activado correctamente.' : 'Tipo de corte inactivado correctamente.')
      await loadCutTypes()
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo actualizar el estado.')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <main className="page cut-types-page" aria-busy={isLoading}>
      <div className="page-header">
        <div>
          <h1>Tipos de corte</h1>
          <p>Administrá preparaciones reutilizables para asociarlas a productos base.</p>
        </div>
      </div>

      {formState.type !== 'closed' && canWriteProducts ? (
        <Panel
          className="cut-types-panel"
          title={formState.type === 'create' ? 'Nuevo tipo de corte' : 'Editar tipo de corte'}
        >
          <form className="cut-types-form" onSubmit={handleSubmit}>
            <label className="field">
              Nombre
              <input
                type="text"
                value={formState.values.name}
                onChange={(event) => updateForm('name', event.target.value)}
                disabled={isSubmitting}
                required
              />
              {fieldError ? <span className="form-error">{fieldError}</span> : null}
            </label>

            <label className="field cut-types-form__description">
              Descripción (opcional)
              <input
                type="text"
                value={formState.values.description}
                onChange={(event) => updateForm('description', event.target.value)}
                disabled={isSubmitting}
              />
            </label>

            <div className="cut-types-form__actions">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Guardando...' : 'Guardar'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isSubmitting}
                onClick={() => setFormState({ type: 'closed' })}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel className="cut-types-panel" title="Preparaciones" action={<span>Total: {cutTypes.length}</span>}>
        <div className="products-toolbar">
          <label className="field products-toolbar__field">
            Buscar por nombre o descripción
            <input
              type="search"
              placeholder="Ej: Bastón, Juliana"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          <label className="field products-toolbar__field products-toolbar__field--compact">
            Estado
            <select
              className="select-input"
              value={status}
              onChange={(event) => setStatus(event.target.value as CutTypesStatusFilter)}
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </label>
        </div>

        {isLoading ? <p>Cargando tipos de corte...</p> : null}
        {canShowEmptyState ? <p>No hay tipos de corte para los filtros seleccionados.</p> : null}

        {!isLoading && cutTypes.length > 0 ? (
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Descripción</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cutTypes.map((cutType) => (
                  <tr key={cutType.id}>
                    <td>{cutType.name}</td>
                    <td>{cutType.description || 'Sin descripción'}</td>
                    <td>
                      <StatusBadge tone={cutType.isActive ? 'success' : 'warning'}>
                        {cutType.isActive ? 'Activo' : 'Inactivo'}
                      </StatusBadge>
                    </td>
                    <td className="products-table__actions">
                      {canWriteProducts ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={pendingId === cutType.id}
                            onClick={() => setFormState({ type: 'edit', cutType, values: toValues(cutType) })}
                          >
                            Editar
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={pendingId === cutType.id}
                            onClick={() => void handleToggleStatus(cutType)}
                          >
                            {cutType.isActive ? 'Inactivar' : 'Activar'}
                          </Button>
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
      </Panel>

      {errorMessage ? (
        <p className="members-message members-message--error" role="alert" aria-live="polite">
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p className="members-message members-message--success" role="status" aria-live="polite">
          {successMessage}
        </p>
      ) : null}
    </main>
  )
}
