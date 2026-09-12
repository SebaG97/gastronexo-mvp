import { useEffect, useMemo, useState } from 'react'
import { Button, Panel, StatusBadge } from '../../shared/components'
import {
  ApiError,
  createPurchase,
  createSupplier,
  getProducts,
  getPurchaseById,
  getPurchases,
  getSuppliers,
  getWarehouses,
  updateSupplier,
  updateSupplierStatus,
  type Product,
  type Purchase,
  type PurchaseDetail,
  type Supplier,
  type SuppliersStatusFilter,
  type Warehouse,
} from '../../shared/lib/auth-api'
import { productUnitLabelByKey } from '../products/product-units'

const PURCHASES_PAGE_SIZE = 10
const SUPPLIERS_PAGE_SIZE = 8

const moneyFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const quantityFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

type PurchasesViewProps = {
  token: string
  canWritePurchases: boolean
  createRequestId: number
}

type PurchaseFormItem = {
  productId: string
  quantity: string
  unitCost: string
}

type SupplierForm = {
  name: string
  taxId: string
  phone: string
  email: string
  address: string
  notes: string
}

type SupplierFormMode =
  | { type: 'closed' }
  | { type: 'create' }
  | { type: 'edit'; supplier: Supplier }

const defaultSupplierForm: SupplierForm = {
  name: '',
  taxId: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
}

function formatMoney(value: string | number) {
  const numericValue = Number(value)
  return `Gs. ${moneyFormatter.format(Number.isFinite(numericValue) ? Math.round(numericValue) : 0)}`
}

function formatQuantity(value: string | number) {
  const numericValue = Number(value)
  return quantityFormatter.format(Number.isFinite(numericValue) ? numericValue : 0)
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function supplierToForm(supplier: Supplier): SupplierForm {
  return {
    name: supplier.name,
    taxId: supplier.taxId ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    address: supplier.address ?? '',
    notes: supplier.notes ?? '',
  }
}

function emptyToNull(value: string) {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function PurchasesView({ token, canWritePurchases, createRequestId }: PurchasesViewProps) {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [purchasePage, setPurchasePage] = useState(1)
  const [purchaseTotal, setPurchaseTotal] = useState(0)
  const [purchaseTotalPages, setPurchaseTotalPages] = useState(0)
  const [purchaseSearch, setPurchaseSearch] = useState('')
  const [debouncedPurchaseSearch, setDebouncedPurchaseSearch] = useState('')
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseDetail | null>(null)
  const [isLoadingPurchases, setIsLoadingPurchases] = useState(true)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [activeSuppliers, setActiveSuppliers] = useState<Supplier[]>([])
  const [supplierPage, setSupplierPage] = useState(1)
  const [supplierTotal, setSupplierTotal] = useState(0)
  const [supplierTotalPages, setSupplierTotalPages] = useState(0)
  const [supplierStatus, setSupplierStatus] = useState<SuppliersStatusFilter>('all')
  const [supplierSearch, setSupplierSearch] = useState('')
  const [debouncedSupplierSearch, setDebouncedSupplierSearch] = useState('')
  const [supplierFormMode, setSupplierFormMode] = useState<SupplierFormMode>({ type: 'closed' })
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(defaultSupplierForm)
  const [pendingSupplierId, setPendingSupplierId] = useState<string | null>(null)

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [rawMaterials, setRawMaterials] = useState<Product[]>([])
  const [isPurchaseFormOpen, setIsPurchaseFormOpen] = useState(false)
  const [purchaseSupplierId, setPurchaseSupplierId] = useState('')
  const [purchaseWarehouseId, setPurchaseWarehouseId] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(todayIsoDate())
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('contado')
  const [purchaseNotes, setPurchaseNotes] = useState('')
  const [purchaseItems, setPurchaseItems] = useState<PurchaseFormItem[]>([
    { productId: '', quantity: '1', unitCost: '0' },
  ])

  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false)
  const [isSubmittingSupplier, setIsSubmittingSupplier] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const purchaseTotalAmount = useMemo(
    () =>
      purchaseItems.reduce((total, item) => {
        const quantity = Number(item.quantity)
        const unitCost = Number(item.unitCost)
        return Number.isFinite(quantity) && Number.isFinite(unitCost) ? total + quantity * unitCost : total
      }, 0),
    [purchaseItems],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedPurchaseSearch(purchaseSearch.trim())
      setPurchasePage(1)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [purchaseSearch])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSupplierSearch(supplierSearch.trim())
      setSupplierPage(1)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [supplierSearch])

  useEffect(() => {
    if (createRequestId > 0 && canWritePurchases) {
      setIsPurchaseFormOpen(true)
      setErrorMessage(null)
      setSuccessMessage(null)
    }
  }, [canWritePurchases, createRequestId])

  async function loadPurchases() {
    setIsLoadingPurchases(true)
    setErrorMessage(null)

    try {
      const response = await getPurchases(
        { q: debouncedPurchaseSearch || undefined, page: purchasePage, pageSize: PURCHASES_PAGE_SIZE },
        token,
      )
      setPurchases(response.purchases)
      setPurchaseTotal(response.pagination.total)
      setPurchaseTotalPages(response.pagination.totalPages)
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudieron cargar las compras.')
      setPurchases([])
    } finally {
      setIsLoadingPurchases(false)
    }
  }

  async function loadSuppliers() {
    try {
      const [activeResponse, listResponse] = await Promise.all([
        getSuppliers({ status: 'active', page: 1, pageSize: 100 }, token),
        getSuppliers(
          {
            q: debouncedSupplierSearch || undefined,
            status: supplierStatus,
            page: supplierPage,
            pageSize: SUPPLIERS_PAGE_SIZE,
          },
          token,
        ),
      ])

      setActiveSuppliers(activeResponse.suppliers)
      setSuppliers(listResponse.suppliers)
      setSupplierTotal(listResponse.pagination.total)
      setSupplierTotalPages(listResponse.pagination.totalPages)

      if (!purchaseSupplierId && activeResponse.suppliers[0]) {
        setPurchaseSupplierId(activeResponse.suppliers[0].id)
      }
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudieron cargar los proveedores.')
      setSuppliers([])
      setActiveSuppliers([])
    }
  }

  async function loadPurchaseOptions() {
    try {
      const [warehousesResponse, productsResponse] = await Promise.all([
        getWarehouses('active', token),
        getProducts({ status: 'active', productType: 'raw_material', page: 1, pageSize: 100 }, token),
      ])

      setWarehouses(warehousesResponse.warehouses)
      setRawMaterials(productsResponse.products)

      if (!purchaseWarehouseId && warehousesResponse.warehouses[0]) {
        setPurchaseWarehouseId(warehousesResponse.warehouses[0].id)
      }

      if (purchaseItems.length === 1 && !purchaseItems[0].productId && productsResponse.products[0]) {
        setPurchaseItems([
          { productId: productsResponse.products[0].id, quantity: '1', unitCost: String(productsResponse.products[0].cost) },
        ])
      }
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudieron cargar los datos para compras.')
    }
  }

  useEffect(() => {
    void loadPurchases()
  }, [debouncedPurchaseSearch, purchasePage, token])

  useEffect(() => {
    void loadSuppliers()
  }, [debouncedSupplierSearch, supplierPage, supplierStatus, token])

  useEffect(() => {
    void loadPurchaseOptions()
  }, [token])

  async function handleSelectPurchase(purchaseId: string) {
    setIsLoadingDetail(true)
    setErrorMessage(null)

    try {
      const response = await getPurchaseById(purchaseId, token)
      setSelectedPurchase(response.purchase)
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo cargar el detalle de compra.')
    } finally {
      setIsLoadingDetail(false)
    }
  }

  function updatePurchaseItem(index: number, patch: Partial<PurchaseFormItem>) {
    setPurchaseItems((currentItems) =>
      currentItems.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    )
  }

  function addPurchaseItem() {
    setPurchaseItems((currentItems) => [
      ...currentItems,
      { productId: rawMaterials[0]?.id ?? '', quantity: '1', unitCost: String(rawMaterials[0]?.cost ?? 0) },
    ])
  }

  function removePurchaseItem(index: number) {
    setPurchaseItems((currentItems) => currentItems.filter((_item, itemIndex) => itemIndex !== index))
  }

  async function handleSubmitPurchase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!purchaseSupplierId || !purchaseWarehouseId) {
      setErrorMessage('Seleccioná proveedor y depósito para registrar la compra.')
      return
    }

    const normalizedItems = purchaseItems.map((item) => ({
      productId: item.productId,
      quantity: Number(item.quantity),
      unitCost: Number(item.unitCost),
    }))

    if (
      normalizedItems.some(
        (item) =>
          !item.productId ||
          !Number.isFinite(item.quantity) ||
          item.quantity <= 0 ||
          !Number.isFinite(item.unitCost) ||
          item.unitCost <= 0,
      )
    ) {
      setErrorMessage('Cada item debe tener materia prima, cantidad y costo unitario mayor a 0.')
      return
    }

    setIsSubmittingPurchase(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const response = await createPurchase(
        {
          supplierId: purchaseSupplierId,
          warehouseId: purchaseWarehouseId,
          invoiceNumber: invoiceNumber.trim(),
          purchaseDate,
          paymentMethod: paymentMethod.trim(),
          notes: emptyToNull(purchaseNotes),
          items: normalizedItems,
        },
        token,
      )

      setSelectedPurchase(response.purchase)
      setSuccessMessage('Compra registrada correctamente.')
      setInvoiceNumber('')
      setPurchaseNotes('')
      setPurchaseItems([{ productId: rawMaterials[0]?.id ?? '', quantity: '1', unitCost: String(rawMaterials[0]?.cost ?? 0) }])
      setIsPurchaseFormOpen(false)
      await Promise.all([loadPurchases(), loadPurchaseOptions()])
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo registrar la compra.')
    } finally {
      setIsSubmittingPurchase(false)
    }
  }

  async function handleSubmitSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supplierForm.name.trim()) {
      setErrorMessage('El nombre del proveedor es obligatorio.')
      return
    }

    setIsSubmittingSupplier(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    const payload = {
      name: supplierForm.name.trim(),
      taxId: emptyToNull(supplierForm.taxId),
      phone: emptyToNull(supplierForm.phone),
      email: emptyToNull(supplierForm.email),
      address: emptyToNull(supplierForm.address),
      notes: emptyToNull(supplierForm.notes),
    }

    try {
      if (supplierFormMode.type === 'edit') {
        await updateSupplier(supplierFormMode.supplier.id, payload, token)
        setSuccessMessage('Proveedor actualizado correctamente.')
      } else {
        await createSupplier(payload, token)
        setSuccessMessage('Proveedor creado correctamente.')
      }

      setSupplierFormMode({ type: 'closed' })
      setSupplierForm(defaultSupplierForm)
      await loadSuppliers()
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo guardar el proveedor.')
    } finally {
      setIsSubmittingSupplier(false)
    }
  }

  async function handleToggleSupplierStatus(supplier: Supplier) {
    const nextStatus = !supplier.isActive
    const actionLabel = nextStatus ? 'activar' : 'inactivar'
    if (!window.confirm(`¿Confirmás ${actionLabel} este proveedor?`)) {
      return
    }

    setPendingSupplierId(supplier.id)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      await updateSupplierStatus(supplier.id, nextStatus, token)
      setSuccessMessage(nextStatus ? 'Proveedor activado correctamente.' : 'Proveedor inactivado correctamente.')
      await loadSuppliers()
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo actualizar el proveedor.')
    } finally {
      setPendingSupplierId(null)
    }
  }

  return (
    <main className="page purchases-page" aria-busy={isLoadingPurchases}>
      <div className="page-header">
        <div>
          <h1>Compras</h1>
          <p>Registrá compras de materias primas y actualizá stock y costo promedio.</p>
        </div>
      </div>

      {canWritePurchases && isPurchaseFormOpen ? (
        <Panel className="purchases-panel" title="Registrar compra">
          <form className="purchase-form" onSubmit={handleSubmitPurchase}>
            <label className="field">
              Proveedor
              <select className="select-input" value={purchaseSupplierId} onChange={(event) => setPurchaseSupplierId(event.target.value)} required>
                {activeSuppliers.length === 0 ? <option value="">Sin proveedores activos</option> : null}
                {activeSuppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Depósito
              <select className="select-input" value={purchaseWarehouseId} onChange={(event) => setPurchaseWarehouseId(event.target.value)} required>
                {warehouses.length === 0 ? <option value="">Sin depósitos activos</option> : null}
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Fecha
              <input type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} required />
            </label>
            <label className="field">
              Factura / referencia
              <input value={invoiceNumber} maxLength={120} onChange={(event) => setInvoiceNumber(event.target.value)} required />
            </label>
            <label className="field">
              Método de pago
              <input value={paymentMethod} maxLength={60} onChange={(event) => setPaymentMethod(event.target.value)} required />
            </label>
            <label className="field purchase-form__notes">
              Notas
              <input value={purchaseNotes} maxLength={600} onChange={(event) => setPurchaseNotes(event.target.value)} placeholder="Opcional" />
            </label>

            <div className="purchase-form__items">
              <div className="purchase-form__items-header">
                <strong>Items</strong>
                <Button type="button" variant="secondary" onClick={addPurchaseItem}>Agregar item</Button>
              </div>
              {purchaseItems.map((item, index) => {
                const product = rawMaterials.find((candidate) => candidate.id === item.productId)
                const lineTotal = Number(item.quantity) * Number(item.unitCost)

                return (
                  <div className="purchase-item-row" key={`${index}:${item.productId}`}>
                    <label className="field">
                      Materia prima
                      <select
                        className="select-input"
                        value={item.productId}
                        onChange={(event) => {
                          const nextProduct = rawMaterials.find((candidate) => candidate.id === event.target.value)
                          updatePurchaseItem(index, { productId: event.target.value, unitCost: String(nextProduct?.cost ?? item.unitCost) })
                        }}
                        required
                      >
                        {rawMaterials.map((rawMaterial) => (
                          <option key={rawMaterial.id} value={rawMaterial.id}>{rawMaterial.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Cantidad
                      <input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => updatePurchaseItem(index, { quantity: event.target.value })} required />
                    </label>
                    <label className="field">
                      Costo unitario
                      <input type="number" min="0.01" step="0.01" value={item.unitCost} onChange={(event) => updatePurchaseItem(index, { unitCost: event.target.value })} required />
                    </label>
                    <span className="purchase-item-row__subtotal">
                      {formatMoney(Number.isFinite(lineTotal) ? lineTotal : 0)}
                      {product ? <small>{productUnitLabelByKey[product.unit]}</small> : null}
                    </span>
                    <Button type="button" variant="secondary" disabled={purchaseItems.length === 1} onClick={() => removePurchaseItem(index)}>Quitar</Button>
                  </div>
                )
              })}
            </div>

            <div className="purchase-form__summary">
              <span>Total</span>
              <strong>{formatMoney(purchaseTotalAmount)}</strong>
            </div>

            <div className="products-form__actions">
              <Button type="submit" disabled={isSubmittingPurchase || activeSuppliers.length === 0 || warehouses.length === 0 || rawMaterials.length === 0}>
                {isSubmittingPurchase ? 'Guardando...' : 'Registrar compra'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setIsPurchaseFormOpen(false)}>Cerrar</Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel className="purchases-panel" title="Historial de compras" action={<span>Total: {purchaseTotal}</span>}>
        <div className="products-toolbar">
          <label className="field products-toolbar__field">
            Buscar por factura o proveedor
            <input type="search" value={purchaseSearch} onChange={(event) => setPurchaseSearch(event.target.value)} placeholder="Ej: factura 001" />
          </label>
        </div>

        {isLoadingPurchases ? <p>Cargando compras...</p> : null}
        {!isLoadingPurchases && purchases.length === 0 ? <p>No hay compras para los filtros seleccionados.</p> : null}

        {!isLoadingPurchases && purchases.length > 0 ? (
          <table className="products-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Depósito</th>
                <th>Factura</th>
                <th>Total</th>
                <th>Usuario</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => (
                <tr key={purchase.id}>
                  <td>{new Date(purchase.purchaseDate).toLocaleDateString('es-PY')}</td>
                  <td>{purchase.supplierName}</td>
                  <td>{purchase.warehouseName}</td>
                  <td>{purchase.invoiceNumber}</td>
                  <td>{formatMoney(purchase.totalAmount)}</td>
                  <td>{purchase.createdByUserName}</td>
                  <td className="products-table__actions">
                    <Button type="button" variant="secondary" disabled={isLoadingDetail} onClick={() => void handleSelectPurchase(purchase.id)}>Ver detalle</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <div className="products-pagination">
          <span>Página {purchasePage} de {Math.max(purchaseTotalPages, 1)}</span>
          <div className="products-pagination__actions">
            <Button type="button" variant="secondary" disabled={purchasePage <= 1} onClick={() => setPurchasePage((current) => current - 1)}>Anterior</Button>
            <Button type="button" variant="secondary" disabled={purchaseTotalPages === 0 || purchasePage >= purchaseTotalPages} onClick={() => setPurchasePage((current) => current + 1)}>Siguiente</Button>
          </div>
        </div>
      </Panel>

      {selectedPurchase ? (
        <Panel className="purchases-panel" title={`Detalle ${selectedPurchase.invoiceNumber}`}>
          <div className="purchase-detail-grid">
            <span>Proveedor: <strong>{selectedPurchase.supplierName}</strong></span>
            <span>Depósito: <strong>{selectedPurchase.warehouseName}</strong></span>
            <span>Pago: <strong>{selectedPurchase.paymentMethod}</strong></span>
            <span>Total: <strong>{formatMoney(selectedPurchase.totalAmount)}</strong></span>
          </div>
          <table className="products-table">
            <thead>
              <tr>
                <th>Materia prima</th>
                <th>Unidad</th>
                <th>Cantidad</th>
                <th>Costo unitario</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {selectedPurchase.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.productName}</td>
                  <td>{productUnitLabelByKey[item.unit]}</td>
                  <td>{formatQuantity(item.quantity)}</td>
                  <td>{formatMoney(item.unitCost)}</td>
                  <td>{formatMoney(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selectedPurchase.notes ? <p className="purchase-detail-notes">{selectedPurchase.notes}</p> : null}
        </Panel>
      ) : null}

      <Panel
        className="purchases-panel"
        title="Proveedores"
        action={
          canWritePurchases ? (
            <Button type="button" variant="secondary" onClick={() => { setSupplierFormMode({ type: 'create' }); setSupplierForm(defaultSupplierForm) }}>
              Nuevo proveedor
            </Button>
          ) : (
            <span>Solo lectura</span>
          )
        }
      >
        {supplierFormMode.type !== 'closed' && canWritePurchases ? (
          <form className="supplier-form" onSubmit={handleSubmitSupplier}>
            <label className="field">
              Nombre
              <input value={supplierForm.name} maxLength={160} onChange={(event) => setSupplierForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label className="field">
              RUC / documento
              <input value={supplierForm.taxId} maxLength={80} onChange={(event) => setSupplierForm((current) => ({ ...current, taxId: event.target.value }))} />
            </label>
            <label className="field">
              Teléfono
              <input value={supplierForm.phone} maxLength={80} onChange={(event) => setSupplierForm((current) => ({ ...current, phone: event.target.value }))} />
            </label>
            <label className="field">
              Email
              <input type="email" value={supplierForm.email} maxLength={160} onChange={(event) => setSupplierForm((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label className="field">
              Dirección
              <input value={supplierForm.address} maxLength={240} onChange={(event) => setSupplierForm((current) => ({ ...current, address: event.target.value }))} />
            </label>
            <label className="field">
              Notas
              <input value={supplierForm.notes} maxLength={600} onChange={(event) => setSupplierForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <div className="products-form__actions">
              <Button type="submit" disabled={isSubmittingSupplier}>{isSubmittingSupplier ? 'Guardando...' : 'Guardar proveedor'}</Button>
              <Button type="button" variant="secondary" onClick={() => setSupplierFormMode({ type: 'closed' })}>Cancelar</Button>
            </div>
          </form>
        ) : null}

        <div className="products-toolbar">
          <label className="field products-toolbar__field">
            Buscar proveedor
            <input type="search" value={supplierSearch} onChange={(event) => setSupplierSearch(event.target.value)} placeholder="Nombre, RUC o email" />
          </label>
          <label className="field products-toolbar__field products-toolbar__field--compact">
            Estado
            <select className="select-input" value={supplierStatus} onChange={(event) => { setSupplierStatus(event.target.value as SuppliersStatusFilter); setSupplierPage(1) }}>
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </label>
        </div>

        {suppliers.length === 0 ? <p>No hay proveedores para los filtros seleccionados.</p> : null}
        {suppliers.length > 0 ? (
          <table className="products-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>RUC / documento</th>
                <th>Email</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <td>{supplier.name}</td>
                  <td>{supplier.taxId ?? 'Sin dato'}</td>
                  <td>{supplier.email ?? 'Sin dato'}</td>
                  <td><StatusBadge tone={supplier.isActive ? 'success' : 'warning'}>{supplier.isActive ? 'Activo' : 'Inactivo'}</StatusBadge></td>
                  <td className="products-table__actions">
                    {canWritePurchases ? (
                      <>
                        <Button type="button" variant="secondary" disabled={pendingSupplierId === supplier.id} onClick={() => { setSupplierFormMode({ type: 'edit', supplier }); setSupplierForm(supplierToForm(supplier)) }}>Editar</Button>
                        <Button type="button" variant="secondary" disabled={pendingSupplierId === supplier.id} onClick={() => void handleToggleSupplierStatus(supplier)}>{supplier.isActive ? 'Inactivar' : 'Activar'}</Button>
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
          <span>Página {supplierPage} de {Math.max(supplierTotalPages, 1)} · Total: {supplierTotal}</span>
          <div className="products-pagination__actions">
            <Button type="button" variant="secondary" disabled={supplierPage <= 1} onClick={() => setSupplierPage((current) => current - 1)}>Anterior</Button>
            <Button type="button" variant="secondary" disabled={supplierTotalPages === 0 || supplierPage >= supplierTotalPages} onClick={() => setSupplierPage((current) => current + 1)}>Siguiente</Button>
          </div>
        </div>
      </Panel>

      {errorMessage ? <p className="members-message members-message--error" role="alert" aria-live="polite">{errorMessage}</p> : null}
      {successMessage ? <p className="members-message members-message--success" role="status" aria-live="polite">{successMessage}</p> : null}
    </main>
  )
}
