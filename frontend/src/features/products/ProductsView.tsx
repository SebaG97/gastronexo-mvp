import { useEffect, useMemo, useState } from 'react'
import { Button, Panel, StatusBadge } from '../../shared/components'
import {
  ApiError,
  createProduct,
  getProducts,
  updateProduct,
  updateProductStatus,
  type Product,
  type ProductsStatusFilter,
} from '../../shared/lib/auth-api'
import { ProductForm, type ProductFormValues } from './ProductForm'

const PAGE_SIZE = 10

const guaraniFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

type ProductsViewProps = {
  token: string
  canWriteProducts: boolean
  createRequestId: number
}

type FormMode =
  | { type: 'closed' }
  | { type: 'create' }
  | { type: 'edit'; product: Product }

function formatCost(value: number) {
  return `Gs. ${guaraniFormatter.format(Math.round(value))}`
}

function toFormValues(product: Product): ProductFormValues {
  return {
    name: product.name,
    sku: product.sku ?? '',
    unit: product.unit,
    cost: String(product.cost),
  }
}

export function ProductsView({ token, canWriteProducts, createRequestId }: ProductsViewProps) {
  const [products, setProducts] = useState<Product[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [status, setStatus] = useState<ProductsStatusFilter>('active')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [formMode, setFormMode] = useState<FormMode>({ type: 'closed' })
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingProductId, setPendingProductId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const canShowEmptyState = useMemo(
    () => !isLoading && products.length === 0 && !errorMessage,
    [errorMessage, isLoading, products.length],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim())
      setPage(1)
    }, 350)

    return () => {
      window.clearTimeout(timer)
    }
  }, [searchTerm])

  useEffect(() => {
    if (createRequestId > 0 && canWriteProducts) {
      setFormMode({ type: 'create' })
      setSuccessMessage(null)
      setErrorMessage(null)
    }
  }, [canWriteProducts, createRequestId])

  async function loadProducts() {
    setErrorMessage(null)
    setIsLoading(true)

    try {
      const response = await getProducts(
        {
          q: debouncedSearchTerm || undefined,
          status,
          page,
          pageSize: PAGE_SIZE,
        },
        token,
      )

      setProducts(response.products)
      setTotal(response.pagination.total)
      setTotalPages(response.pagination.totalPages)
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo cargar el catálogo de productos.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadProducts()
  }, [debouncedSearchTerm, page, status, token])

  async function handleCreate(values: { name: string; sku?: string; unit: string; cost: number }) {
    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      await createProduct(values, token)
      setFormMode({ type: 'closed' })
      setSuccessMessage('Producto creado correctamente.')
      await loadProducts()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo crear el producto.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleEdit(values: { name: string; sku?: string; unit: string; cost: number }) {
    if (formMode.type !== 'edit') {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      await updateProduct(formMode.product.id, values, token)
      setFormMode({ type: 'closed' })
      setSuccessMessage('Producto actualizado correctamente.')
      await loadProducts()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo actualizar el producto.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleToggleStatus(product: Product) {
    const nextStatus = !product.isActive
    const actionLabel = nextStatus ? 'activar' : 'inactivar'

    if (!window.confirm(`¿Confirmás ${actionLabel} este producto?`)) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setPendingProductId(product.id)

    try {
      await updateProductStatus(product.id, nextStatus, token)
      setSuccessMessage(nextStatus ? 'Producto activado correctamente.' : 'Producto inactivado correctamente.')
      await loadProducts()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo actualizar el estado del producto.')
      }
    } finally {
      setPendingProductId(null)
    }
  }

  return (
    <main className="page products-page" aria-busy={isLoading}>
      <div className="page-header">
        <div>
          <h1>Productos</h1>
          <p>Gestioná productos y costos de la organización activa.</p>
        </div>
      </div>

      {(formMode.type === 'create' || formMode.type === 'edit') && canWriteProducts ? (
        <Panel
          className="products-panel"
          title={formMode.type === 'create' ? 'Nuevo producto' : 'Editar producto'}
        >
          <ProductForm
            initialValues={formMode.type === 'edit' ? toFormValues(formMode.product) : undefined}
            submitLabel={formMode.type === 'create' ? 'Crear producto' : 'Guardar cambios'}
            isSubmitting={isSubmitting}
            onSubmit={(values) =>
              formMode.type === 'create' ? handleCreate(values) : handleEdit(values)
            }
            onCancel={() => setFormMode({ type: 'closed' })}
          />
        </Panel>
      ) : null}

      <Panel className="products-panel" title="Catálogo" action={<span>Total: {total}</span>}>
        <div className="products-toolbar">
          <label className="field products-toolbar__field">
            Buscar por nombre o SKU
            <input
              type="search"
              placeholder="Ej: Harina, SKU-001"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          <label className="field products-toolbar__field products-toolbar__field--compact">
            Estado
            <select
              className="select-input"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as ProductsStatusFilter)
                setPage(1)
              }}
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </label>
        </div>

        {isLoading ? <p>Cargando productos...</p> : null}
        {canShowEmptyState ? <p>No hay productos para los filtros seleccionados.</p> : null}

        {!isLoading && products.length > 0 ? (
          <table className="products-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>SKU</th>
                <th>Unidad</th>
                <th>Costo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.sku ?? '—'}</td>
                  <td>{product.unit}</td>
                  <td>{formatCost(product.cost)}</td>
                  <td>
                    <StatusBadge tone={product.isActive ? 'success' : 'warning'}>
                      {product.isActive ? 'Activo' : 'Inactivo'}
                    </StatusBadge>
                  </td>
                  <td className="products-table__actions">
                    {canWriteProducts ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={pendingProductId === product.id}
                          onClick={() => setFormMode({ type: 'edit', product })}
                        >
                          Editar
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={pendingProductId === product.id}
                          onClick={() => void handleToggleStatus(product)}
                        >
                          {product.isActive ? 'Inactivar' : 'Activar'}
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
