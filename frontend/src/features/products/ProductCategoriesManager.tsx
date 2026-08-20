import { useEffect, useState } from 'react'
import { Button, StatusBadge } from '../../shared/components'
import {
  ApiError,
  createProductCategory,
  getProductCategories,
  updateProductCategory,
  updateProductCategoryStatus,
  type ProductCategoriesStatusFilter,
  type ProductCategory,
} from '../../shared/lib/auth-api'

type ProductCategoriesManagerProps = {
  token: string
  canWriteProducts: boolean
  onChanged: () => Promise<void>
}

export function ProductCategoriesManager({ token, canWriteProducts, onChanged }: ProductCategoriesManagerProps) {
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [status, setStatus] = useState<ProductCategoriesStatusFilter>('all')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  async function loadCategories() {
    setIsLoading(true)

    try {
      const response = await getProductCategories(status, token)
      setCategories(response.categories)
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudieron cargar las categorías.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadCategories()
  }, [status, token])

  async function handleCreateCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const name = newCategoryName.trim()
    if (!name) {
      setErrorMessage('El nombre de la categoría es obligatorio.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      await createProductCategory({ name }, token)
      setNewCategoryName('')
      setSuccessMessage('Categoría creada correctamente.')
      await loadCategories()
      await onChanged()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo crear la categoría.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleRenameCategory(category: ProductCategory) {
    if (!canWriteProducts) {
      return
    }

    const nextName = window.prompt('Nuevo nombre de categoría', category.name)?.trim()
    if (!nextName || nextName === category.name) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setPendingCategoryId(category.id)

    try {
      await updateProductCategory(category.id, { name: nextName }, token)
      setSuccessMessage('Categoría actualizada correctamente.')
      await loadCategories()
      await onChanged()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo actualizar la categoría.')
      }
    } finally {
      setPendingCategoryId(null)
    }
  }

  async function handleToggleStatus(category: ProductCategory) {
    if (!canWriteProducts) {
      return
    }

    const nextStatus = !category.isActive
    const actionLabel = nextStatus ? 'activar' : 'inactivar'

    if (!window.confirm(`¿Confirmás ${actionLabel} esta categoría?`)) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setPendingCategoryId(category.id)

    try {
      await updateProductCategoryStatus(category.id, nextStatus, token)
      setSuccessMessage(nextStatus ? 'Categoría activada correctamente.' : 'Categoría inactivada correctamente.')
      await loadCategories()
      await onChanged()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo actualizar el estado de la categoría.')
      }
    } finally {
      setPendingCategoryId(null)
    }
  }

  return (
    <section className="products-categories" aria-busy={isLoading}>
      <div className="products-categories__toolbar">
        <label className="field products-categories__filter">
          Estado
          <select
            className="select-input"
            value={status}
            onChange={(event) => setStatus(event.target.value as ProductCategoriesStatusFilter)}
          >
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
        </label>

        {canWriteProducts ? (
          <form className="products-categories__create" onSubmit={handleCreateCategory}>
            <label className="field products-categories__field">
              Nueva categoría
              <input
                type="text"
                value={newCategoryName}
                maxLength={120}
                onChange={(event) => setNewCategoryName(event.target.value)}
                disabled={isSubmitting}
                placeholder="Ej: Secos"
              />
            </label>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando...' : 'Crear'}
            </Button>
          </form>
        ) : (
          <span className="products-table__no-actions">Solo lectura</span>
        )}
      </div>

      {isLoading ? <p>Cargando categorías...</p> : null}
      {!isLoading && categories.length === 0 ? <p>No hay categorías para el filtro seleccionado.</p> : null}

      {!isLoading && categories.length > 0 ? (
        <table className="products-table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id}>
                <td>{category.name}</td>
                <td>
                  <StatusBadge tone={category.isActive ? 'success' : 'warning'}>
                    {category.isActive ? 'Activa' : 'Inactiva'}
                  </StatusBadge>
                </td>
                <td className="products-table__actions">
                  {canWriteProducts ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pendingCategoryId === category.id}
                        onClick={() => void handleRenameCategory(category)}
                      >
                        Renombrar
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pendingCategoryId === category.id}
                        onClick={() => void handleToggleStatus(category)}
                      >
                        {category.isActive ? 'Inactivar' : 'Activar'}
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
      ) : null}

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
    </section>
  )
}
