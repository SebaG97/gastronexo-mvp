import { useEffect, useState } from 'react'
import { Package, RefreshCw, PlusCircle } from 'lucide-react'
import { Button, Panel, StatusBadge } from '../../shared/components'
import { ApiError, type ProductItem, createProduct, getProducts } from '../../shared/lib/api'

type ProductsViewProps = {
  token: string
  onAuthExpired: () => void
}

export function ProductsView({ token, onAuthExpired }: ProductsViewProps) {
  const [items, setItems] = useState<ProductItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [unit, setUnit] = useState('unidad')
  const [stock, setStock] = useState(0)

  const loadProducts = async () => {
    setLoading(true)
    setLoadError('')

    try {
      setItems(await getProducts(token))
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 401) {
        onAuthExpired()
        return
      }

      setLoadError(caughtError instanceof Error ? caughtError.message : 'No se pudieron cargar los productos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProducts()
  }, [token])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Productos</h1>
          <p>Conectado a <code>GET/POST /api/products</code> con JWT local.</p>
        </div>
        <Button onClick={() => void loadProducts()} variant="secondary">
          <RefreshCw size={16} />
          Refrescar
        </Button>
      </div>

      <div className="products-layout">
        <Panel title="Alta de producto">
          <form
            className="products-form"
            onSubmit={async (event) => {
              event.preventDefault()
              setSaving(true)
              setFormError('')

              try {
                const created = await createProduct(token, {
                  name,
                  sku: sku.trim() || undefined,
                  unit,
                  stock,
                })

                setItems((current) => [created, ...current])
                setName('')
                setSku('')
                setUnit('unidad')
                setStock(0)
              } catch (caughtError) {
                if (caughtError instanceof ApiError && caughtError.status === 401) {
                  onAuthExpired()
                  return
                }

                setFormError(caughtError instanceof Error ? caughtError.message : 'No se pudo crear el producto')
              } finally {
                setSaving(false)
              }
            }}
          >
            <label className="field">
              Nombre
              <input
                onChange={(event) => setName(event.target.value)}
                placeholder="Milanesa de pollo"
                required
                value={name}
              />
            </label>
            <label className="field">
              SKU
              <input
                onChange={(event) => setSku(event.target.value)}
                placeholder="SKU-001"
                value={sku}
              />
            </label>
            <label className="field">
              Unidad
              <input
                onChange={(event) => setUnit(event.target.value)}
                placeholder="unidad"
                required
                value={unit}
              />
            </label>
            <label className="field">
              Stock inicial
              <input
                min="0"
                onChange={(event) => setStock(Number(event.target.value))}
                type="number"
                value={stock}
              />
            </label>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <Button disabled={saving} type="submit">
              <PlusCircle size={16} />
              {saving ? 'Guardando...' : 'Crear producto'}
            </Button>
          </form>
        </Panel>

        <Panel
          action={<StatusBadge tone={loading ? 'warning' : 'success'}>{loading ? 'Cargando' : `${items.length} ítems`}</StatusBadge>}
          title="Listado"
        >
          {loading ? (
            <div className="empty-state">Cargando productos...</div>
          ) : loadError ? (
            <div className="empty-state empty-state--error">
              <p>{loadError}</p>
              <Button onClick={() => void loadProducts()} variant="secondary">
                Reintentar
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <Package aria-hidden="true" />
              <p>No hay productos todavía.</p>
            </div>
          ) : (
            <div className="products-table">
              <div className="products-table__row products-table__row--header">
                <span>Nombre</span>
                <span>SKU</span>
                <span>Unidad</span>
                <span>Stock</span>
              </div>
              {items.map((item) => (
                <div className="products-table__row" key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{item.sku ?? '—'}</span>
                  <span>{item.unit}</span>
                  <span>{item.stock}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
