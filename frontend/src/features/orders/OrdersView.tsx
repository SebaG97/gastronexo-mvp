import { useEffect, useMemo, useState } from 'react'
import { Button, LoadErrorState, Panel, StatusBadge, TableScroll } from '../../shared/components'
import {
  ApiError,
  createCustomer,
  createOrder,
  getCustomers,
  getOrderById,
  getOrders,
  getInsufficientStockError,
  getProductById,
  getProducts,
  getWarehouses,
  updateOrder,
  updateOrderStatus,
  type Customer,
  type InsufficientStockError,
  type Order,
  type OrderDetail,
  type OrderMutationInput,
  type OrderStatus,
  type Product,
  type ProductCutOption,
  type Warehouse,
} from '../../shared/lib/auth-api'
import { productUnitLabelByKey } from '../products/product-units'

function StockShortageNotice({ error }: { error: InsufficientStockError }) {
  return (
    <div className="stock-shortage" role="alert">
      <p>Stock insuficiente en {error.warehouseName}. No se reservó nada.</p>
      <ul>
        {error.shortages.map((shortage) => {
          const unit = productUnitLabelByKey[shortage.unit]
          return (
            <li key={shortage.productId}>
              <strong>{shortage.productName}</strong>: pedido {formatQuantity(shortage.requested)} {unit} · disponible{' '}
              {formatQuantity(shortage.available)} {unit} · faltan <strong>{formatQuantity(shortage.missing)} {unit}</strong>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const PAGE_SIZE = 10

const moneyFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const quantityFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

const statusLabelByKey: Record<OrderStatus, string> = {
  new: 'Nuevo',
  confirmed: 'Confirmado',
  preparing: 'En preparacion',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

const statusToneByKey: Record<OrderStatus, 'success' | 'warning' | 'danger'> = {
  new: 'warning',
  confirmed: 'success',
  preparing: 'warning',
  ready: 'success',
  delivered: 'success',
  cancelled: 'danger',
}

const transitionActionByStatus: Record<OrderStatus, string> = {
  new: 'Volver a nuevo',
  confirmed: 'Confirmar',
  preparing: 'Iniciar preparacion',
  ready: 'Marcar listo',
  delivered: 'Entregar',
  cancelled: 'Cancelar',
}

type OrdersViewProps = {
  token: string
  canWriteOrders: boolean
  createRequestId: number
}

type OrderFormItem = {
  productId: string
  cutTypeId: string
  quantity: string
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
  | { type: 'edit'; order: OrderDetail }

const defaultCustomerForm: CustomerForm = {
  name: '',
  businessName: '',
  documentNumber: '',
  phone: '',
  email: '',
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

function emptyToNull(value: string) {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function getDefaultCutId(product: Product | undefined) {
  const activeOptions = (product?.cutOptions ?? []).filter((option) => option.isActive && option.cutTypeIsActive)
  return activeOptions.find((option) => option.isDefault)?.cutTypeId ?? activeOptions[0]?.cutTypeId ?? ''
}

function getActiveCutOptions(product: Product | undefined) {
  return (product?.cutOptions ?? []).filter((option) => option.isActive && option.cutTypeIsActive)
}

function getEffectivePrice(product: Product | undefined, cutOption: ProductCutOption | undefined) {
  const salePrice = Number(product?.salePrice ?? 0)
  const modifier = Number(cutOption?.priceModifier ?? 0)
  return salePrice + modifier
}

function buildMutationInput(
  customerId: string,
  orderDate: string,
  requestedDeliveryDate: string,
  notes: string,
  items: OrderFormItem[],
): OrderMutationInput {
  return {
    customerId,
    orderDate,
    requestedDeliveryDate: emptyToNull(requestedDeliveryDate),
    notes: emptyToNull(notes),
    items: items.map((item) => ({
      productId: item.productId,
      cutTypeId: item.cutTypeId || null,
      quantity: Number(item.quantity),
    })),
  }
}

export function OrdersView({ token, canWriteOrders, createRequestId }: OrdersViewProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [isLoadingOrders, setIsLoadingOrders] = useState(true)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [sellableProducts, setSellableProducts] = useState<Product[]>([])
  const [productDetailsById, setProductDetailsById] = useState<Record<string, Product>>({})

  const [formMode, setFormMode] = useState<FormMode>({ type: 'closed' })
  const [customerId, setCustomerId] = useState('')
  const [orderDate, setOrderDate] = useState(todayIsoDate())
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<OrderFormItem[]>([])
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null)
  const [availableTransitions, setAvailableTransitions] = useState<OrderStatus[]>([])
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [dispatchWarehouseId, setDispatchWarehouseId] = useState('')
  const [stockError, setStockError] = useState<InsufficientStockError | null>(null)

  const [isCustomerFormOpen, setIsCustomerFormOpen] = useState(false)
  const [customerForm, setCustomerForm] = useState<CustomerForm>(defaultCustomerForm)
  const [isSubmittingCustomer, setIsSubmittingCustomer] = useState(false)
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const formTotal = useMemo(
    () =>
      items.reduce((totalAmount, item) => {
        const product = productDetailsById[item.productId]
        const cutOption = getActiveCutOptions(product).find((option) => option.cutTypeId === item.cutTypeId)
        const quantity = Number(item.quantity)
        const lineTotal = quantity * getEffectivePrice(product, cutOption)
        return Number.isFinite(lineTotal) ? totalAmount + lineTotal : totalAmount
      }, 0),
    [items, productDetailsById],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim())
      setPage(1)
    }, 350)

    return () => window.clearTimeout(timer)
  }, [searchTerm])

  useEffect(() => {
    if (createRequestId > 0 && canWriteOrders) {
      openCreateForm()
    }
  }, [canWriteOrders, createRequestId])

  async function loadOrders() {
    setIsLoadingOrders(true)
    setLoadError(null)

    try {
      const response = await getOrders(
        {
          q: debouncedSearchTerm || undefined,
          status,
          page,
          pageSize: PAGE_SIZE,
        },
        token,
      )
      setOrders(response.orders)
      setTotal(response.pagination.total)
      setTotalPages(response.pagination.totalPages)
    } catch {
      setLoadError('No se pudieron cargar los pedidos.')
      setOrders([])
    } finally {
      setIsLoadingOrders(false)
    }
  }

  async function loadOptions() {
    try {
      const [customersResponse, productsResponse, warehousesResponse] = await Promise.all([
        getCustomers({ status: 'active', page: 1, pageSize: 100 }, token),
        getProducts({ status: 'active', page: 1, pageSize: 100 }, token),
        getWarehouses('active', token),
      ])

      const sellable = productsResponse.products.filter((product) => product.isSellable)
      setCustomers(customersResponse.customers)
      setSellableProducts(sellable)
      setWarehouses(warehousesResponse.warehouses)
      setDispatchWarehouseId((current) => current || warehousesResponse.warehouses[0]?.id || '')

      if (!customerId && customersResponse.customers[0]) {
        setCustomerId(customersResponse.customers[0].id)
      }

      if (items.length === 0 && sellable[0]) {
        const productDetail = await ensureProductDetail(sellable[0].id)
        setItems([{ productId: sellable[0].id, cutTypeId: getDefaultCutId(productDetail), quantity: '1' }])
      }
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudieron cargar clientes y productos.')
    }
  }

  useEffect(() => {
    void loadOrders()
  }, [debouncedSearchTerm, page, status, token])

  useEffect(() => {
    void loadOptions()
  }, [token])

  async function ensureProductDetail(productId: string) {
    if (productDetailsById[productId]) {
      return productDetailsById[productId]
    }

    const response = await getProductById(productId, token)
    setProductDetailsById((current) => ({ ...current, [productId]: response.product }))
    return response.product
  }

  async function openCreateForm() {
    setFormMode({ type: 'create' })
    setSelectedOrder(null)
    setStockError(null)
    setOrderDate(todayIsoDate())
    setRequestedDeliveryDate('')
    setNotes('')
    setErrorMessage(null)
    setSuccessMessage(null)

    const firstCustomerId = customers[0]?.id ?? customerId
    const firstProduct = sellableProducts[0]
    setCustomerId(firstCustomerId)

    if (firstProduct) {
      const productDetail = await ensureProductDetail(firstProduct.id)
      setItems([{ productId: firstProduct.id, cutTypeId: getDefaultCutId(productDetail), quantity: '1' }])
    } else {
      setItems([])
    }
  }

  async function openEditForm(order: OrderDetail) {
    setFormMode({ type: 'edit', order })
    setStockError(null)
    setCustomerId(order.customerId)
    setOrderDate(order.orderDate.slice(0, 10))
    setRequestedDeliveryDate(order.requestedDeliveryDate?.slice(0, 10) ?? '')
    setNotes(order.notes ?? '')
    setItems(order.items.map((item) => ({ productId: item.productId, cutTypeId: item.cutTypeId ?? '', quantity: item.quantity })))
    await Promise.all(order.items.map((item) => ensureProductDetail(item.productId)))
  }

  async function handleSelectOrder(orderId: string) {
    setIsLoadingDetail(true)
    setErrorMessage(null)
    setStockError(null)

    try {
      const response = await getOrderById(orderId, token)
      setSelectedOrder(response.order)
      setAvailableTransitions(response.transitions)
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo cargar el detalle del pedido.')
    } finally {
      setIsLoadingDetail(false)
    }
  }

  async function updateItem(index: number, patch: Partial<OrderFormItem>) {
    const nextPatch = { ...patch }
    if (patch.productId) {
      const productDetail = await ensureProductDetail(patch.productId)
      nextPatch.cutTypeId = getDefaultCutId(productDetail)
    }

    setItems((currentItems) =>
      currentItems.map((item, itemIndex) => (itemIndex === index ? { ...item, ...nextPatch } : item)),
    )
  }

  async function addItem() {
    const firstProduct = sellableProducts[0]
    if (!firstProduct) {
      return
    }

    const productDetail = await ensureProductDetail(firstProduct.id)
    setItems((currentItems) => [
      ...currentItems,
      { productId: firstProduct.id, cutTypeId: getDefaultCutId(productDetail), quantity: '1' },
    ])
  }

  function removeItem(index: number) {
    setItems((currentItems) => currentItems.filter((_item, itemIndex) => itemIndex !== index))
  }

  async function handleCreateInlineCustomer() {
    if (!customerForm.name.trim()) {
      setErrorMessage('El nombre del cliente es obligatorio.')
      return
    }

    setIsSubmittingCustomer(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const response = await createCustomer(
        {
          name: customerForm.name.trim(),
          businessName: emptyToNull(customerForm.businessName),
          documentNumber: emptyToNull(customerForm.documentNumber),
          phone: emptyToNull(customerForm.phone),
          email: emptyToNull(customerForm.email),
          notes: emptyToNull(customerForm.notes),
        },
        token,
      )
      setSuccessMessage('Cliente creado correctamente.')
      setCustomerForm(defaultCustomerForm)
      setIsCustomerFormOpen(false)
      await loadOptions()
      setCustomerId(response.customer.id)
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo guardar el cliente.')
    } finally {
      setIsSubmittingCustomer(false)
    }
  }

  async function handleSubmitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!customerId) {
      setErrorMessage('Selecciona un cliente activo.')
      return
    }
    if (items.length === 0) {
      setErrorMessage('Agrega al menos un producto al pedido.')
      return
    }
    if (items.some((item) => !item.productId || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
      setErrorMessage('Cada item debe tener producto y cantidad mayor a 0.')
      return
    }

    setIsSubmittingOrder(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    setStockError(null)

    try {
      const payload = buildMutationInput(customerId, orderDate, requestedDeliveryDate, notes, items)
      const response =
        formMode.type === 'edit'
          ? await updateOrder(formMode.order.id, payload, token)
          : await createOrder(payload, token)

      setSelectedOrder(response.order)
      setAvailableTransitions(response.transitions)
      setFormMode({ type: 'closed' })
      setSuccessMessage(formMode.type === 'edit' ? 'Pedido actualizado correctamente.' : 'Pedido creado correctamente.')
      await loadOrders()
    } catch (error) {
      const insufficientStock = getInsufficientStockError(error)
      if (insufficientStock) {
        setStockError(insufficientStock)
      } else {
        setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo guardar el pedido.')
      }
    } finally {
      setIsSubmittingOrder(false)
    }
  }

  // Un pedido sin deposito (nuevo, o confirmado antes de 6.1) lo elige al avanzar: ahi se reserva el stock.
  const needsDispatchWarehouse =
    selectedOrder !== null &&
    selectedOrder.warehouseId === null &&
    availableTransitions.some((transition) => transition !== 'cancelled')

  async function handleStatusChange(nextStatus: OrderStatus) {
    if (!selectedOrder) {
      return
    }

    if (nextStatus === 'cancelled' && !window.confirm('Confirmas cancelar este pedido?')) {
      return
    }

    const warehouseId = needsDispatchWarehouse && nextStatus !== 'cancelled' ? dispatchWarehouseId : undefined
    if (needsDispatchWarehouse && nextStatus !== 'cancelled' && !warehouseId) {
      setErrorMessage('Selecciona el deposito desde el que se va a despachar el pedido.')
      return
    }

    setPendingStatus(nextStatus)
    setErrorMessage(null)
    setSuccessMessage(null)
    setStockError(null)

    try {
      const response = await updateOrderStatus(selectedOrder.id, nextStatus, token, warehouseId)
      setSelectedOrder(response.order)
      setAvailableTransitions(response.transitions)
      setSuccessMessage(
        warehouseId
          ? `Estado actualizado. Stock reservado en ${response.order.warehouseName ?? 'el deposito'}.`
          : nextStatus === 'delivered'
            ? 'Pedido entregado. Stock descontado del deposito.'
            : 'Estado del pedido actualizado.',
      )
      await loadOrders()
    } catch (error) {
      const insufficientStock = getInsufficientStockError(error)
      if (insufficientStock) {
        setStockError(insufficientStock)
      } else {
        setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo cambiar el estado.')
      }
    } finally {
      setPendingStatus(null)
    }
  }

  return (
    <main className="page orders-page" aria-busy={isLoadingOrders}>
      <div className="page-header">
        <div>
          <h1>Pedidos</h1>
          <p>Gestiona pedidos administrativos con precios y cortes congelados.</p>
        </div>
      </div>

      {formMode.type !== 'closed' && canWriteOrders ? (
        <Panel className="orders-panel" title={formMode.type === 'edit' ? `Editar ${formMode.order.orderNumber}` : 'Nuevo pedido'}>
          <form className="order-form" onSubmit={handleSubmitOrder}>
            <section className="order-form__section">
              <div className="order-form__section-header">
                <strong>Cliente</strong>
                <Button type="button" variant="secondary" onClick={() => setIsCustomerFormOpen((current) => !current)}>
                  Nuevo cliente
                </Button>
              </div>
              <label className="field">
                Cliente
                <select className="select-input" value={customerId} onChange={(event) => setCustomerId(event.target.value)} required>
                  {customers.length === 0 ? <option value="">Sin clientes activos</option> : null}
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
              </label>
            </section>

            {isCustomerFormOpen ? (
              <section className="order-form__section order-form__section--wide">
                <div className="order-form__section-header"><strong>Alta rapida de cliente</strong></div>
                <div className="customer-inline-form">
                  <label className="field">Nombre<input value={customerForm.name} maxLength={160} onChange={(event) => setCustomerForm((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label className="field">Razon social<input value={customerForm.businessName} maxLength={160} onChange={(event) => setCustomerForm((current) => ({ ...current, businessName: event.target.value }))} /></label>
                  <label className="field">Documento<input value={customerForm.documentNumber} maxLength={80} onChange={(event) => setCustomerForm((current) => ({ ...current, documentNumber: event.target.value }))} /></label>
                  <label className="field">Telefono<input value={customerForm.phone} maxLength={80} onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))} /></label>
                  <label className="field">Email<input type="email" value={customerForm.email} maxLength={160} onChange={(event) => setCustomerForm((current) => ({ ...current, email: event.target.value }))} /></label>
                  <label className="field">Notas<input value={customerForm.notes} maxLength={600} onChange={(event) => setCustomerForm((current) => ({ ...current, notes: event.target.value }))} /></label>
                  <div className="products-form__actions">
                    <Button type="button" disabled={isSubmittingCustomer} onClick={() => void handleCreateInlineCustomer()}>{isSubmittingCustomer ? 'Guardando...' : 'Guardar cliente'}</Button>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="order-form__section">
              <div className="order-form__section-header"><strong>Datos del pedido</strong></div>
              <label className="field">Fecha<input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} required /></label>
              <label className="field">Entrega solicitada<input type="date" value={requestedDeliveryDate} onChange={(event) => setRequestedDeliveryDate(event.target.value)} /></label>
              <label className="field order-form__notes">Notas<input value={notes} maxLength={600} onChange={(event) => setNotes(event.target.value)} placeholder="Opcional" /></label>
            </section>

            <section className="order-form__items">
              <div className="order-form__section-header">
                <strong>Items</strong>
                <Button type="button" variant="secondary" onClick={() => void addItem()} disabled={sellableProducts.length === 0}>Agregar producto</Button>
              </div>
              {items.length === 0 ? <p>No hay productos vendibles activos para agregar.</p> : null}
              {items.map((item, index) => {
                const product = productDetailsById[item.productId]
                const activeCuts = getActiveCutOptions(product)
                const selectedCut = activeCuts.find((option) => option.cutTypeId === item.cutTypeId)
                const effectivePrice = getEffectivePrice(product, selectedCut)
                const subtotal = Number(item.quantity) * effectivePrice

                return (
                  <div className="order-item-row" key={`${index}:${item.productId}`}>
                    <label className="field">
                      Producto
                      <select className="select-input" value={item.productId} onChange={(event) => void updateItem(index, { productId: event.target.value })} required>
                        {sellableProducts.map((productOption) => (
                          <option key={productOption.id} value={productOption.id}>{productOption.name}</option>
                        ))}
                      </select>
                    </label>
                    {activeCuts.length > 0 ? (
                      <label className="field">
                        Corte
                        <select className="select-input" value={item.cutTypeId} onChange={(event) => void updateItem(index, { cutTypeId: event.target.value })} required>
                          {activeCuts.map((cut) => (
                            <option key={cut.id} value={cut.cutTypeId}>{cut.cutTypeName}</option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <span className="order-item-row__muted">Sin corte</span>
                    )}
                    <label className="field">
                      Cantidad
                      <input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(event) => void updateItem(index, { quantity: event.target.value })} required />
                    </label>
                    <span className="order-item-row__subtotal">
                      {formatMoney(effectivePrice)}
                      <small>{product ? `/${productUnitLabelByKey[product.unit]}` : ''}</small>
                    </span>
                    <span className="order-item-row__subtotal">
                      {formatMoney(Number.isFinite(subtotal) ? subtotal : 0)}
                      <small>Subtotal</small>
                    </span>
                    <Button type="button" variant="secondary" disabled={items.length === 1} onClick={() => removeItem(index)}>Quitar</Button>
                  </div>
                )
              })}
            </section>

            <div className="order-form__summary">
              <span>Total</span>
              <strong>{formatMoney(formTotal)}</strong>
            </div>

            {formMode.type === 'edit' && formMode.order.warehouseId && formMode.order.status === 'confirmed' ? (
              <p className="purchase-detail-notes">
                El pedido tiene stock reservado en {formMode.order.warehouseName}: al guardar se ajusta la reserva.
              </p>
            ) : null}
            {stockError ? <StockShortageNotice error={stockError} /> : null}

            <div className="products-form__actions">
              <Button type="submit" disabled={isSubmittingOrder || customers.length === 0 || sellableProducts.length === 0}>{isSubmittingOrder ? 'Guardando...' : 'Guardar pedido'}</Button>
              <Button type="button" variant="secondary" onClick={() => setFormMode({ type: 'closed' })}>Cerrar</Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel className="orders-panel" title="Listado de pedidos" action={loadError ? undefined : <span>Total: {total}</span>}>
        <div className="products-toolbar">
          <label className="field products-toolbar__field">
            Buscar por numero o cliente
            <input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="PED-000001 o cliente" />
          </label>
          <label className="field products-toolbar__field products-toolbar__field--compact">
            Estado
            <select className="select-input" value={status} onChange={(event) => { setStatus(event.target.value as OrderStatus | 'all'); setPage(1) }}>
              <option value="all">Todos</option>
              {Object.entries(statusLabelByKey).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        {loadError ? <LoadErrorState message={loadError} onRetry={() => void loadOrders()} isRetrying={isLoadingOrders} /> : null}
        {isLoadingOrders ? <p>Cargando pedidos...</p> : null}
        {!isLoadingOrders && !loadError && orders.length === 0 ? <p>No hay pedidos para los filtros seleccionados.</p> : null}
        {!isLoadingOrders && orders.length > 0 ? (
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Numero</th>
                  <th>Cliente</th>
                  <th>Fecha</th>
                  <th>Entrega</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Deposito</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>{order.orderNumber}</td>
                    <td>{order.customerName}</td>
                    <td>{new Date(order.orderDate).toLocaleDateString('es-PY')}</td>
                    <td>{order.requestedDeliveryDate ? new Date(order.requestedDeliveryDate).toLocaleDateString('es-PY') : 'Sin fecha'}</td>
                    <td>{order.itemCount}</td>
                    <td>{formatMoney(order.total)}</td>
                    <td>{order.warehouseName ?? 'Sin asignar'}</td>
                    <td><StatusBadge tone={statusToneByKey[order.status]}>{statusLabelByKey[order.status]}</StatusBadge></td>
                    <td className="products-table__actions">
                      <Button type="button" variant="secondary" disabled={isLoadingDetail} onClick={() => void handleSelectOrder(order.id)}>Ver detalle</Button>
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

      {selectedOrder ? (
        <Panel
          className="orders-panel"
          title={`Detalle ${selectedOrder.orderNumber}`}
          action={<StatusBadge tone={statusToneByKey[selectedOrder.status]}>{statusLabelByKey[selectedOrder.status]}</StatusBadge>}
        >
          <div className="order-detail-grid">
            <span>Cliente: <strong>{selectedOrder.customerName}</strong></span>
            <span>Fecha: <strong>{new Date(selectedOrder.orderDate).toLocaleDateString('es-PY')}</strong></span>
            <span>Entrega: <strong>{selectedOrder.requestedDeliveryDate ? new Date(selectedOrder.requestedDeliveryDate).toLocaleDateString('es-PY') : 'Sin fecha'}</strong></span>
            <span>Total: <strong>{formatMoney(selectedOrder.total)}</strong></span>
            <span>Deposito: <strong>{selectedOrder.warehouseName ?? 'Sin asignar'}</strong></span>
            {selectedOrder.deliveredAt ? (
              <span>Entregado: <strong>{new Date(selectedOrder.deliveredAt).toLocaleString('es-PY')}</strong></span>
            ) : null}
          </div>
          {selectedOrder.notes ? <p className="purchase-detail-notes">{selectedOrder.notes}</p> : null}
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Corte</th>
                  <th>Cantidad</th>
                  <th>Precio base</th>
                  <th>Recargo corte</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {selectedOrder.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.productNameSnapshot}</td>
                    <td>{item.cutNameSnapshot ?? 'Sin corte'}</td>
                    <td>{formatQuantity(item.quantity)} {productUnitLabelByKey[item.productUnitSnapshot]}</td>
                    <td>{formatMoney(item.unitPrice)}</td>
                    <td>{formatMoney(item.cutPriceModifier)}</td>
                    <td>{formatMoney(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>

          <div className="order-actions">
            {canWriteOrders && needsDispatchWarehouse ? (
              <label className="field order-warehouse-picker">
                Deposito de despacho
                <select
                  className="select-input"
                  value={dispatchWarehouseId}
                  onChange={(event) => {
                    setDispatchWarehouseId(event.target.value)
                    setStockError(null)
                  }}
                  disabled={pendingStatus !== null || warehouses.length === 0}
                >
                  {warehouses.length === 0 ? <option value="">Sin depositos activos</option> : null}
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {canWriteOrders && (selectedOrder.status === 'new' || selectedOrder.status === 'confirmed') ? (
              <Button type="button" variant="secondary" onClick={() => void openEditForm(selectedOrder)}>Editar pedido</Button>
            ) : null}
            {canWriteOrders && availableTransitions.map((nextStatus) => (
              <Button key={nextStatus} type="button" variant={nextStatus === 'cancelled' ? 'secondary' : 'primary'} disabled={pendingStatus === nextStatus} onClick={() => void handleStatusChange(nextStatus)}>
                {pendingStatus === nextStatus ? 'Actualizando...' : transitionActionByStatus[nextStatus]}
              </Button>
            ))}
            {!canWriteOrders ? <span className="products-table__no-actions">Solo lectura</span> : null}
          </div>
          {stockError && formMode.type === 'closed' ? <StockShortageNotice error={stockError} /> : null}

          <div className="order-history">
            <strong>Historial</strong>
            {selectedOrder.history.map((entry) => (
              <span key={entry.id}>
                {entry.fromStatus ? `${statusLabelByKey[entry.fromStatus]} a ` : ''}{statusLabelByKey[entry.toStatus]} por {entry.changedByUserName} - {new Date(entry.createdAt).toLocaleString('es-PY')}
              </span>
            ))}
          </div>
        </Panel>
      ) : null}

      {errorMessage ? <p className="members-message members-message--error" role="alert" aria-live="polite">{errorMessage}</p> : null}
      {successMessage ? <p className="members-message members-message--success" role="status" aria-live="polite">{successMessage}</p> : null}
    </main>
  )
}
