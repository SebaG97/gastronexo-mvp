import { useEffect, useMemo, useState } from 'react'
import { Button, LoadErrorState, Modal, Panel, StatusBadge } from '../../shared/components'
import {
  ApiError,
  createCustomer,
  createOrder,
  getCustomers,
  getOrderById,
  getOrders,
  getOrdersBoard,
  getInsufficientStockError,
  getProductById,
  getProducts,
  getWarehouses,
  updateOrder,
  updateOrderStatus,
  type BoardOrder,
  type Customer,
  type InsufficientStockError,
  type Order,
  type OrderDetail,
  type OrderChannel,
  type OrderMutationInput,
  type OrderStatus,
  type OrdersBoardResponse,
  type Product,
  type ProductCutOption,
  type Warehouse,
} from '../../shared/lib/auth-api'
import { productUnitLabelByKey } from '../products/product-units'
import { OrderDetailSheet, StockShortageNotice } from './OrderDetailSheet'
import { OrdersBoard } from './OrdersBoard'
import { formatMoney, statusLabelByKey, statusToneByKey } from './orders-format'

const PAGE_SIZE = 10

type OrdersViewProps = {
  token: string
  canWriteOrders: boolean
  createRequestId: number
  /** Cambia cuando entran pedidos nuevos de la tienda: recarga la lista sin parpadeo. */
  refreshKey?: number
  /** Pedido a abrir desde el aviso de pedido nuevo. */
  openOrderRequest?: { orderId: string; nonce: number } | null
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

export function OrdersView({ token, canWriteOrders, createRequestId, refreshKey = 0, openOrderRequest = null }: OrdersViewProps) {
  const [orders, setOrders] = useState<Order[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [channel, setChannel] = useState<OrderChannel | 'all'>('all')
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
  // Mision 9.1: tablero, detalle en panel y avisos cortos.
  const [view, setView] = useState<'board' | 'history'>('board')
  const [board, setBoard] = useState<OrdersBoardResponse | null>(null)
  const [isLoadingBoard, setIsLoadingBoard] = useState(true)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error'; id: number } | null>(null)

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

  async function loadOrders({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) {
      setIsLoadingOrders(true)
    }
    setLoadError(null)

    try {
      const response = await getOrders(
        {
          q: debouncedSearchTerm || undefined,
          status,
          channel,
          page,
          pageSize: PAGE_SIZE,
        },
        token,
      )
      setOrders(response.orders)
      setTotal(response.pagination.total)
      setTotalPages(response.pagination.totalPages)
    } catch {
      if (!silent) {
        setLoadError('No se pudieron cargar los pedidos.')
        setOrders([])
      }
    } finally {
      if (!silent) {
        setIsLoadingOrders(false)
      }
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
    if (view === 'history') void loadOrders()
  }, [view, debouncedSearchTerm, page, status, channel, token])

  useEffect(() => {
    if (!openOrderRequest) {
      return
    }
    void openDetail(openOrderRequest.orderId)
  }, [openOrderRequest])

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
    setStockError(null)
    setOrderDate(todayIsoDate())
    setRequestedDeliveryDate('')
    setNotes('')
    setErrorMessage(null)

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
      setDetailError(error instanceof ApiError ? error.message : 'No se pudo cargar el detalle del pedido.')
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
      showToast('Cliente creado.')
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
      setErrorMessage('Seleccioná un cliente activo.')
      return
    }
    if (items.length === 0) {
      setErrorMessage('Agregá al menos un producto al pedido.')
      return
    }
    if (items.some((item) => !item.productId || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
      setErrorMessage('Cada item debe tener producto y cantidad mayor a 0.')
      return
    }

    setIsSubmittingOrder(true)
    setErrorMessage(null)
    setStockError(null)

    try {
      const payload = buildMutationInput(customerId, orderDate, requestedDeliveryDate, notes, items)
      const response =
        formMode.type === 'edit'
          ? await updateOrder(formMode.order.id, payload, token)
          : await createOrder(payload, token)

      if (isDetailOpen) {
        setSelectedOrder(response.order)
        setAvailableTransitions(response.transitions)
      }
      setFormMode({ type: 'closed' })
      showToast(formMode.type === 'edit' ? `${response.order.orderNumber} actualizado.` : `${response.order.orderNumber} creado.`)
      await refreshLists()
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

  const orderForm = (
      <form id="order-form" className="order-form" onSubmit={handleSubmitOrder}>
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
              <label className="field">Razón social<input value={customerForm.businessName} maxLength={160} onChange={(event) => setCustomerForm((current) => ({ ...current, businessName: event.target.value }))} /></label>
              <label className="field">Documento<input value={customerForm.documentNumber} maxLength={80} onChange={(event) => setCustomerForm((current) => ({ ...current, documentNumber: event.target.value }))} /></label>
              <label className="field">Teléfono<input value={customerForm.phone} maxLength={80} onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))} /></label>
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
            <strong>Ítems</strong>
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
        {errorMessage ? <p className="members-message members-message--error" role="alert">{errorMessage}</p> : null}
      </form>
  )

  // ---------- Mision 9.1: tablero, detalle en panel, avisos cortos ----------

  function showToast(text: string, tone: 'success' | 'error' = 'success') {
    setToast({ text, tone, id: Date.now() })
  }

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3800)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function loadBoard({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setIsLoadingBoard(true)
    try {
      const response = await getOrdersBoard(token)
      setBoard(response)
      setBoardError(null)
    } catch {
      if (!silent) setBoardError('No se pudo cargar el tablero de pedidos.')
    } finally {
      if (!silent) setIsLoadingBoard(false)
    }
  }

  useEffect(() => {
    void loadBoard()
    // Otros operadores tambien mueven pedidos: refresco liviano cada 30 s.
    const timer = window.setInterval(() => void loadBoard({ silent: true }), 30_000)
    return () => window.clearInterval(timer)
  }, [token])

  useEffect(() => {
    if (refreshKey > 0) void loadBoard({ silent: true })
  }, [refreshKey])

  async function refreshLists() {
    await Promise.all([loadBoard({ silent: true }), view === 'history' ? loadOrders({ silent: true }) : Promise.resolve()])
  }

  async function openDetail(orderId: string) {
    setIsDetailOpen(true)
    setSelectedOrder(null)
    setDetailError(null)
    setStockError(null)
    await handleSelectOrder(orderId)
  }

  function closeDetail() {
    setIsDetailOpen(false)
    setSelectedOrder(null)
    setStockError(null)
    setDetailError(null)
  }

  function successTextFor(nextStatus: OrderStatus, orderNumber: string, warehouseName: string | null, reserved: boolean) {
    if (reserved) return `${orderNumber} confirmado. Stock reservado en ${warehouseName ?? 'el depósito'}.`
    if (nextStatus === 'delivered') return `${orderNumber} entregado. Stock descontado.`
    if (nextStatus === 'cancelled') return `${orderNumber} cancelado.`
    return `${orderNumber}: ${statusLabelByKey[nextStatus].toLowerCase()}.`
  }

  /** Avanzar desde la tarjeta. Si hay que elegir deposito entre varios, abre el detalle. */
  async function handleAdvanceFromCard(order: BoardOrder, nextStatus: OrderStatus) {
    const needsWarehouse = order.warehouseId === null && nextStatus !== 'cancelled'
    if (needsWarehouse && warehouses.length !== 1) {
      if (warehouses.length === 0) {
        showToast('No hay depósitos activos para reservar el stock.', 'error')
        return
      }
      await openDetail(order.id)
      return
    }
    const warehouseId = needsWarehouse ? warehouses[0].id : undefined
    setPendingOrderId(order.id)
    try {
      const response = await updateOrderStatus(order.id, nextStatus, token, warehouseId)
      showToast(successTextFor(nextStatus, order.orderNumber, response.order.warehouseName, Boolean(warehouseId)))
      await refreshLists()
    } catch (error) {
      const insufficientStock = getInsufficientStockError(error)
      if (insufficientStock) {
        await openDetail(order.id)
        setStockError(insufficientStock)
      } else {
        showToast(error instanceof ApiError ? error.message : 'No se pudo cambiar el estado.', 'error')
      }
    } finally {
      setPendingOrderId(null)
    }
  }

  async function handleStatusChange(nextStatus: OrderStatus, note?: string) {
    if (!selectedOrder) return false
    const needsWarehouse = selectedOrder.warehouseId === null && nextStatus !== 'cancelled'
    const warehouseId = needsWarehouse ? dispatchWarehouseId || warehouses[0]?.id : undefined
    if (needsWarehouse && !warehouseId) {
      setDetailError('No hay depósitos activos para reservar el stock.')
      return false
    }

    setPendingStatus(nextStatus)
    setDetailError(null)
    setStockError(null)
    try {
      const response = await updateOrderStatus(selectedOrder.id, nextStatus, token, warehouseId, note)
      setSelectedOrder(response.order)
      setAvailableTransitions(response.transitions)
      showToast(successTextFor(nextStatus, response.order.orderNumber, response.order.warehouseName, Boolean(warehouseId)))
      await refreshLists()
      // Cerrado (entregado o cancelado): no queda nada por hacer en el panel.
      if (nextStatus === 'delivered' || nextStatus === 'cancelled') closeDetail()
      return true
    } catch (error) {
      const insufficientStock = getInsufficientStockError(error)
      if (insufficientStock) setStockError(insufficientStock)
      else setDetailError(error instanceof ApiError ? error.message : 'No se pudo cambiar el estado.')
      return false
    } finally {
      setPendingStatus(null)
    }
  }

  const isFormOpen = formMode.type !== 'closed' && canWriteOrders

  return (
    <main className="page orders-page" aria-busy={isLoadingBoard}>
      <div className="page-header orders-page__header">
        <div>
          <h1>Pedidos</h1>
          <p>Mové cada pedido con el botón de su tarjeta. Tocá la tarjeta para ver el detalle.</p>
        </div>
        <div className="segmented" role="tablist" aria-label="Vista">
          <button type="button" role="tab" aria-selected={view === 'board'} className={`segmented__option${view === 'board' ? ' segmented__option--active' : ''}`} onClick={() => setView('board')}>
            Tablero
          </button>
          <button type="button" role="tab" aria-selected={view === 'history'} className={`segmented__option${view === 'history' ? ' segmented__option--active' : ''}`} onClick={() => setView('history')}>
            Historial
          </button>
        </div>
      </div>

      {view === 'board' ? (
        <>
          {boardError ? <LoadErrorState message={boardError} onRetry={() => void loadBoard()} isRetrying={isLoadingBoard} /> : null}
          {isLoadingBoard && !board ? <p>Cargando pedidos…</p> : null}
          {board ? (
            <OrdersBoard
              orders={board.orders}
              today={board.today}
              canWrite={canWriteOrders}
              pendingOrderId={pendingOrderId}
              onOpen={(orderId) => void openDetail(orderId)}
              onAdvance={(order, nextStatus) => void handleAdvanceFromCard(order, nextStatus)}
            />
          ) : null}
          {board?.truncated ? <p className="purchase-detail-notes">Hay más pedidos activos de los que entran en el tablero: usá el Historial para buscarlos.</p> : null}
        </>
      ) : (
        <Panel className="orders-panel" title="Historial de pedidos" action={loadError ? undefined : <span>Total: {total}</span>}>
          <div className="products-toolbar">
            <label className="field products-toolbar__field">
              Buscar por número o cliente
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
            <label className="field products-toolbar__field products-toolbar__field--compact">
              Canal
              <select className="select-input" value={channel} onChange={(event) => { setChannel(event.target.value as OrderChannel | 'all'); setPage(1) }}>
                <option value="all">Todos</option>
                <option value="storefront">Tienda online</option>
                <option value="admin">Carga interna</option>
              </select>
            </label>
          </div>

          {loadError ? <LoadErrorState message={loadError} onRetry={() => void loadOrders()} isRetrying={isLoadingOrders} /> : null}
          {isLoadingOrders ? <p>Cargando pedidos…</p> : null}
          {!isLoadingOrders && !loadError && orders.length === 0 ? <p>No hay pedidos para los filtros seleccionados.</p> : null}
          {!isLoadingOrders && orders.length > 0 ? (
            <ul className="orders-history">
              {orders.map((order) => (
                <li key={order.id}>
                  <button type="button" className="orders-history__row" onClick={() => void openDetail(order.id)}>
                    <span className="orders-history__main">
                      <strong>{order.orderNumber}</strong>
                      <span>{order.customerName}</span>
                    </span>
                    <span className="orders-history__meta">
                      {new Date(order.orderDate).toLocaleDateString('es-PY')} · {order.channel === 'storefront' ? 'Tienda' : 'Interno'} · {order.itemCount} {order.itemCount === 1 ? 'producto' : 'productos'}
                    </span>
                    <span className="orders-history__end">
                      <strong>{formatMoney(order.total)}</strong>
                      <StatusBadge tone={statusToneByKey[order.status]}>{statusLabelByKey[order.status]}</StatusBadge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {loadError ? null : (
            <div className="products-pagination">
              <span>Página {page} de {Math.max(totalPages, 1)}</span>
              <div className="products-pagination__actions">
                <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
                <Button type="button" variant="secondary" disabled={totalPages === 0 || page >= totalPages} onClick={() => setPage((current) => current + 1)}>Siguiente</Button>
              </div>
            </div>
          )}
        </Panel>
      )}

      {isDetailOpen ? (
        <OrderDetailSheet
          order={selectedOrder}
          isLoading={isLoadingDetail}
          transitions={availableTransitions}
          canWrite={canWriteOrders}
          warehouses={warehouses}
          dispatchWarehouseId={dispatchWarehouseId}
          onDispatchWarehouseChange={(warehouseId) => {
            setDispatchWarehouseId(warehouseId)
            setStockError(null)
          }}
          pendingStatus={pendingStatus}
          stockError={formMode.type === 'closed' ? stockError : null}
          errorMessage={detailError}
          onAdvance={(nextStatus) => void handleStatusChange(nextStatus)}
          onCancel={(reason) => handleStatusChange('cancelled', reason)}
          onEdit={() => {
            if (selectedOrder) void openEditForm(selectedOrder)
          }}
          onClose={closeDetail}
        />
      ) : null}

      <Modal
        open={isFormOpen}
        onClose={() => setFormMode({ type: 'closed' })}
        variant="drawer"
        size="lg"
        title={formMode.type === 'edit' ? `Editar ${formMode.order.orderNumber}` : 'Nuevo pedido'}
        footer={
          <div className="order-sheet__footer">
            <Button type="button" variant="secondary" onClick={() => setFormMode({ type: 'closed' })}>Cerrar</Button>
            <Button type="submit" form="order-form" disabled={isSubmittingOrder || customers.length === 0 || sellableProducts.length === 0}>
              {isSubmittingOrder ? 'Guardando…' : formMode.type === 'edit' ? 'Guardar cambios' : `Guardar pedido · ${formatMoney(formTotal)}`}
            </Button>
          </div>
        }
      >
        {isFormOpen ? orderForm : null}
      </Modal>

      {toast ? (
        <div key={toast.id} className={`toast toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          {toast.text}
        </div>
      ) : null}
    </main>
  )
}
