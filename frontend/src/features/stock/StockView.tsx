import { useEffect, useMemo, useState } from 'react'
import { Button, LoadErrorState, Panel, StatusBadge, TableScroll } from '../../shared/components'
import {
  ApiError,
  createInventoryAdjustment,
  createWarehouse,
  getInventoryBalances,
  getInventoryMovements,
  getWarehouses,
  updateWarehouse,
  updateWarehouseStatus,
  type InventoryBalance,
  type InventoryMovement,
  type InventoryMovementType,
  type ProductType,
  type Warehouse,
} from '../../shared/lib/auth-api'
import { productTypeLabelByKey } from '../products/product-types'
import { productUnitLabelByKey } from '../products/product-units'

const INVENTORY_PAGE_SIZE = 10
const MOVEMENTS_PAGE_SIZE = 8

const movementTypeLabelByKey: Record<InventoryMovementType, string> = {
  purchase: 'Compra',
  adjustment: 'Ajuste',
  sale: 'Venta',
  production: 'Producción',
}

const movementToneByKey: Record<InventoryMovementType, 'success' | 'warning' | 'danger'> = {
  purchase: 'success',
  adjustment: 'warning',
  sale: 'danger',
  production: 'success',
}

// Una produccion genera consumo (materia prima), salida (terminado) y, si se anula, movimientos inversos.
const productionSourceDisplay: Partial<
  Record<InventoryMovement['sourceType'], { label: string; tone: 'success' | 'warning' | 'danger' }>
> = {
  production_consumption: { label: 'Producción · consumo', tone: 'warning' },
  production_output: { label: 'Producción · salida', tone: 'success' },
  production_void: { label: 'Producción anulada', tone: 'danger' },
}

function getMovementDisplay(movement: InventoryMovement) {
  return (
    productionSourceDisplay[movement.sourceType] ?? {
      label: movementTypeLabelByKey[movement.movementType],
      tone: movementToneByKey[movement.movementType],
    }
  )
}

const integerQuantityFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const decimalQuantityFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

type StockViewProps = {
  token: string
  canWriteInventory: boolean
  createAdjustmentRequestId: number
}

function formatQuantity(quantity: string | number, unit: string) {
  const value = Number(quantity)
  if (!Number.isFinite(value)) {
    return '0'
  }

  const usesDecimals = unit === 'kg' || unit === 'g' || unit === 'l' || unit === 'ml'
  return usesDecimals ? decimalQuantityFormatter.format(value) : integerQuantityFormatter.format(Math.round(value))
}

function formatDelta(delta: string | number, unit: string) {
  const value = Number(delta)
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${formatQuantity(value, unit)}`
}

export function StockView({ token, canWriteInventory, createAdjustmentRequestId }: StockViewProps) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('')
  const [newWarehouseName, setNewWarehouseName] = useState('')
  const [warehouseStatusFilter, setWarehouseStatusFilter] = useState<'active' | 'inactive' | 'all'>('all')
  const [pendingWarehouseId, setPendingWarehouseId] = useState<string | null>(null)

  const [balances, setBalances] = useState<InventoryBalance[]>([])
  const [inventoryPage, setInventoryPage] = useState(1)
  const [inventoryTotal, setInventoryTotal] = useState(0)
  const [inventoryTotalPages, setInventoryTotalPages] = useState(0)
  const [inventorySearchTerm, setInventorySearchTerm] = useState('')
  const [debouncedInventorySearchTerm, setDebouncedInventorySearchTerm] = useState('')
  const [inventoryProductTypeFilter, setInventoryProductTypeFilter] = useState<'all' | ProductType>('all')

  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(true)
  const [isLoadingInventory, setIsLoadingInventory] = useState(false)
  const [isLoadingMovements, setIsLoadingMovements] = useState(false)
  const [isSubmittingWarehouse, setIsSubmittingWarehouse] = useState(false)
  const [isSubmittingAdjustment, setIsSubmittingAdjustment] = useState(false)

  const [movements, setMovements] = useState<InventoryMovement[]>([])
  const [movementsPage, setMovementsPage] = useState(1)
  const [movementsTotalPages, setMovementsTotalPages] = useState(0)
  const [historyProductIdFilter, setHistoryProductIdFilter] = useState('')
  const [historyMovementTypeFilter, setHistoryMovementTypeFilter] = useState<'' | InventoryMovementType>('')
  const [historyFromDate, setHistoryFromDate] = useState('')
  const [historyToDate, setHistoryToDate] = useState('')

  const [isAdjustmentFormOpen, setIsAdjustmentFormOpen] = useState(false)
  const [adjustmentWarehouseId, setAdjustmentWarehouseId] = useState('')
  const [adjustmentProductId, setAdjustmentProductId] = useState('')
  const [adjustmentNewQuantity, setAdjustmentNewQuantity] = useState('0')
  const [adjustmentReason, setAdjustmentReason] = useState('')

  const [adjustmentProductOptions, setAdjustmentProductOptions] = useState<InventoryBalance[]>([])

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [warehousesLoadError, setWarehousesLoadError] = useState<string | null>(null)
  const [inventoryLoadError, setInventoryLoadError] = useState<string | null>(null)
  const [movementsLoadError, setMovementsLoadError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const activeWarehouses = useMemo(() => warehouses.filter((warehouse) => warehouse.isActive), [warehouses])

  const adjustmentSelectedBalance = useMemo(() => {
    if (!adjustmentWarehouseId || !adjustmentProductId) {
      return null
    }

    return (
      adjustmentProductOptions.find(
        (item) => item.warehouseId === adjustmentWarehouseId && item.productId === adjustmentProductId,
      ) ?? null
    )
  }, [adjustmentProductId, adjustmentProductOptions, adjustmentWarehouseId])

  const adjustmentPreviousQuantity = Number(adjustmentSelectedBalance?.quantity ?? '0')
  const adjustmentReservedQuantity = Number(adjustmentSelectedBalance?.reservedQuantity ?? '0')

  const adjustmentSelectedUnit = useMemo(() => {
    const match = adjustmentProductOptions.find((item) => item.productId === adjustmentProductId)
    return match?.unit ?? 'unit'
  }, [adjustmentProductId, adjustmentProductOptions])

  const adjustmentDelta = useMemo(() => {
    const nextQuantity = Number(adjustmentNewQuantity)
    if (!Number.isFinite(nextQuantity)) {
      return 0
    }

    return nextQuantity - adjustmentPreviousQuantity
  }, [adjustmentNewQuantity, adjustmentPreviousQuantity])

  const canShowInventoryEmpty =
    !isLoadingInventory && !inventoryLoadError && balances.length === 0 && selectedWarehouseId
  const canShowMovementsEmpty = !isLoadingMovements && !movementsLoadError && movements.length === 0

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedInventorySearchTerm(inventorySearchTerm.trim())
      setInventoryPage(1)
    }, 350)

    return () => {
      window.clearTimeout(timer)
    }
  }, [inventorySearchTerm])

  useEffect(() => {
    if (createAdjustmentRequestId > 0 && canWriteInventory) {
      setIsAdjustmentFormOpen(true)
      setAdjustmentWarehouseId(selectedWarehouseId)
      setErrorMessage(null)
      setSuccessMessage(null)
    }
  }, [canWriteInventory, createAdjustmentRequestId, selectedWarehouseId])

  async function loadWarehouses() {
    setIsLoadingWarehouses(true)
    setWarehousesLoadError(null)

    try {
      const response = await getWarehouses('all', token)
      setWarehouses(response.warehouses)

      const nextSelectedWarehouseId =
        selectedWarehouseId && response.warehouses.some((warehouse) => warehouse.id === selectedWarehouseId)
          ? selectedWarehouseId
          : response.warehouses.find((warehouse) => warehouse.isActive)?.id ?? ''

      setSelectedWarehouseId(nextSelectedWarehouseId)

      if (!adjustmentWarehouseId) {
        setAdjustmentWarehouseId(nextSelectedWarehouseId)
      }
    } catch {
      setWarehouses([])
      setWarehousesLoadError('No se pudieron cargar los depósitos.')
    } finally {
      setIsLoadingWarehouses(false)
    }
  }

  async function loadInventory() {
    if (!selectedWarehouseId) {
      setBalances([])
      setInventoryTotal(0)
      setInventoryTotalPages(0)
      return
    }

    setIsLoadingInventory(true)
    setInventoryLoadError(null)

    try {
      const response = await getInventoryBalances(
        {
          warehouseId: selectedWarehouseId,
          productType: inventoryProductTypeFilter === 'all' ? undefined : inventoryProductTypeFilter,
          q: debouncedInventorySearchTerm || undefined,
          page: inventoryPage,
          pageSize: INVENTORY_PAGE_SIZE,
        },
        token,
      )

      setBalances(response.balances)
      setInventoryTotal(response.pagination.total)
      setInventoryTotalPages(response.pagination.totalPages)
    } catch {
      setInventoryLoadError('No se pudo cargar el inventario.')
      setBalances([])
    } finally {
      setIsLoadingInventory(false)
    }
  }

  async function loadAdjustmentProductOptions() {
    if (!adjustmentWarehouseId) {
      setAdjustmentProductOptions([])
      return
    }

    try {
      const response = await getInventoryBalances(
        {
          warehouseId: adjustmentWarehouseId,
          page: 1,
          pageSize: 100,
        },
        token,
      )

      setAdjustmentProductOptions(response.balances)

      if (!response.balances.some((item) => item.productId === adjustmentProductId)) {
        setAdjustmentProductId(response.balances[0]?.productId ?? '')
      }
    } catch {
      setAdjustmentProductOptions([])
    }
  }

  async function loadMovements() {
    if (!selectedWarehouseId) {
      setMovements([])
      setMovementsTotalPages(0)
      return
    }

    setIsLoadingMovements(true)
    setMovementsLoadError(null)

    try {
      const response = await getInventoryMovements(
        {
          warehouseId: selectedWarehouseId,
          productId: historyProductIdFilter || undefined,
          movementType: historyMovementTypeFilter || undefined,
          from: historyFromDate ? `${historyFromDate}T00:00:00.000Z` : undefined,
          to: historyToDate ? `${historyToDate}T23:59:59.999Z` : undefined,
          page: movementsPage,
          pageSize: MOVEMENTS_PAGE_SIZE,
        },
        token,
      )

      setMovements(response.movements)
      setMovementsTotalPages(response.pagination.totalPages)
    } catch {
      setMovementsLoadError('No se pudieron cargar los movimientos de stock.')
      setMovements([])
    } finally {
      setIsLoadingMovements(false)
    }
  }

  useEffect(() => {
    void loadWarehouses()
  }, [token])

  useEffect(() => {
    void loadInventory()
  }, [debouncedInventorySearchTerm, inventoryPage, inventoryProductTypeFilter, selectedWarehouseId, token])

  useEffect(() => {
    void loadAdjustmentProductOptions()
  }, [adjustmentWarehouseId, token])

  useEffect(() => {
    void loadMovements()
  }, [
    movementsPage,
    historyFromDate,
    historyMovementTypeFilter,
    historyProductIdFilter,
    historyToDate,
    selectedWarehouseId,
    token,
  ])

  async function handleCreateWarehouse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedName = newWarehouseName.trim()
    if (!normalizedName) {
      setErrorMessage('El nombre del depósito es obligatorio.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmittingWarehouse(true)

    try {
      await createWarehouse({ name: normalizedName }, token)
      setNewWarehouseName('')
      setSuccessMessage('Depósito creado correctamente.')
      await loadWarehouses()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo crear el depósito.')
      }
    } finally {
      setIsSubmittingWarehouse(false)
    }
  }

  async function handleRenameWarehouse(warehouse: Warehouse) {
    if (!canWriteInventory) {
      return
    }

    const nextName = window.prompt('Nuevo nombre de depósito', warehouse.name)?.trim()
    if (!nextName || nextName === warehouse.name) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setPendingWarehouseId(warehouse.id)

    try {
      await updateWarehouse(warehouse.id, { name: nextName }, token)
      setSuccessMessage('Depósito actualizado correctamente.')
      await loadWarehouses()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo actualizar el depósito.')
      }
    } finally {
      setPendingWarehouseId(null)
    }
  }

  async function handleToggleWarehouseStatus(warehouse: Warehouse) {
    if (!canWriteInventory) {
      return
    }

    const nextStatus = !warehouse.isActive
    const actionLabel = nextStatus ? 'activar' : 'inactivar'

    if (!window.confirm(`¿Confirmás ${actionLabel} este depósito?`)) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setPendingWarehouseId(warehouse.id)

    try {
      await updateWarehouseStatus(warehouse.id, nextStatus, token)
      setSuccessMessage(nextStatus ? 'Depósito activado correctamente.' : 'Depósito inactivado correctamente.')
      await loadWarehouses()
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo actualizar el estado del depósito.')
      }
    } finally {
      setPendingWarehouseId(null)
    }
  }

  async function handleSubmitAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsedNewQuantity = Number(adjustmentNewQuantity)
    const normalizedReason = adjustmentReason.trim()

    if (!adjustmentWarehouseId || !adjustmentProductId) {
      setErrorMessage('Seleccioná depósito y producto para ajustar stock.')
      return
    }

    if (!Number.isFinite(parsedNewQuantity) || parsedNewQuantity < 0) {
      setErrorMessage('La nueva cantidad debe ser mayor o igual a 0.')
      return
    }

    if (!normalizedReason) {
      setErrorMessage('El motivo del ajuste es obligatorio.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmittingAdjustment(true)

    try {
      await createInventoryAdjustment(
        {
          warehouseId: adjustmentWarehouseId,
          productId: adjustmentProductId,
          newQuantity: parsedNewQuantity,
          reason: normalizedReason,
        },
        token,
      )

      setSuccessMessage('Ajuste registrado correctamente.')
      setAdjustmentReason('')
      await Promise.all([loadInventory(), loadMovements(), loadAdjustmentProductOptions()])
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('No se pudo registrar el ajuste de inventario.')
      }
    } finally {
      setIsSubmittingAdjustment(false)
    }
  }

  return (
    <main className="page stock-page">
      <div className="page-header">
        <div>
          <h1>Stock</h1>
          <p>Controlá existencias, reservas por pedidos y movimientos por depósito.</p>
        </div>
      </div>

      <Panel className="stock-panel" title="Depósitos">
        <div className="stock-warehouses__toolbar">
          <label className="field stock-warehouses__selector">
            Depósito activo para consulta
            <select
              className="select-input"
              value={selectedWarehouseId}
              onChange={(event) => {
                setSelectedWarehouseId(event.target.value)
                setInventoryPage(1)
                setMovementsPage(1)
                setAdjustmentWarehouseId(event.target.value)
              }}
              disabled={isLoadingWarehouses || activeWarehouses.length === 0}
            >
              {activeWarehouses.length === 0 ? <option value="">Sin depósitos activos</option> : null}
              {activeWarehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
          </label>

          {canWriteInventory ? (
            <form className="stock-warehouses__create" onSubmit={handleCreateWarehouse}>
              <label className="field stock-warehouses__field">
                Nuevo depósito
                <input
                  type="text"
                  value={newWarehouseName}
                  maxLength={120}
                  onChange={(event) => setNewWarehouseName(event.target.value)}
                  disabled={isSubmittingWarehouse}
                  placeholder="Ej: Depósito Central"
                />
              </label>
              <Button type="submit" disabled={isSubmittingWarehouse}>
                {isSubmittingWarehouse ? 'Guardando...' : 'Crear'}
              </Button>
            </form>
          ) : (
            <span className="products-table__no-actions">Solo lectura</span>
          )}
        </div>

        <div className="stock-warehouses__filter">
          <label className="field stock-warehouses__selector">
            Ver depósitos
            <select
              className="select-input"
              value={warehouseStatusFilter}
              onChange={(event) => setWarehouseStatusFilter(event.target.value as 'active' | 'inactive' | 'all')}
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </label>
        </div>

        {warehousesLoadError ? (
          <LoadErrorState
            message={warehousesLoadError}
            onRetry={() => void loadWarehouses()}
            isRetrying={isLoadingWarehouses}
          />
        ) : null}
        {isLoadingWarehouses ? <p>Cargando depósitos...</p> : null}

        {!isLoadingWarehouses && warehouses.length > 0 ? (
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {warehouses
                  .filter((warehouse) => {
                    if (warehouseStatusFilter === 'all') {
                      return true
                    }
                    if (warehouseStatusFilter === 'active') {
                      return warehouse.isActive
                    }
                    return !warehouse.isActive
                  })
                  .map((warehouse) => (
                    <tr key={warehouse.id}>
                      <td>{warehouse.name}</td>
                      <td>
                        <StatusBadge tone={warehouse.isActive ? 'success' : 'warning'}>
                          {warehouse.isActive ? 'Activo' : 'Inactivo'}
                        </StatusBadge>
                      </td>
                      <td className="products-table__actions">
                        {canWriteInventory ? (
                          <>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={pendingWarehouseId === warehouse.id}
                              onClick={() => void handleRenameWarehouse(warehouse)}
                            >
                              Renombrar
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={pendingWarehouseId === warehouse.id}
                              onClick={() => void handleToggleWarehouseStatus(warehouse)}
                            >
                              {warehouse.isActive ? 'Inactivar' : 'Activar'}
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

      {canWriteInventory && isAdjustmentFormOpen ? (
        <Panel className="stock-panel" title="Registrar ajuste de inventario">
          <form className="stock-adjustment-form" onSubmit={handleSubmitAdjustment}>
            <label className="field">
              Depósito
              <select
                className="select-input"
                value={adjustmentWarehouseId}
                onChange={(event) => setAdjustmentWarehouseId(event.target.value)}
                disabled={isSubmittingAdjustment}
                required
              >
                {activeWarehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              Producto
              <select
                className="select-input"
                value={adjustmentProductId}
                onChange={(event) => setAdjustmentProductId(event.target.value)}
                disabled={isSubmittingAdjustment || adjustmentProductOptions.length === 0}
                required
              >
                {adjustmentProductOptions.map((item) => (
                  <option key={item.productId} value={item.productId}>
                    {item.productName} · {productTypeLabelByKey[item.productType]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              Nueva cantidad
              <input
                type="number"
                min="0"
                step="0.001"
                value={adjustmentNewQuantity}
                onChange={(event) => setAdjustmentNewQuantity(event.target.value)}
                disabled={isSubmittingAdjustment}
                required
              />
            </label>

            <label className="field">
              Motivo
              <input
                type="text"
                maxLength={300}
                value={adjustmentReason}
                onChange={(event) => setAdjustmentReason(event.target.value)}
                disabled={isSubmittingAdjustment}
                placeholder="Ej: conteo físico de cierre"
                required
              />
            </label>

            <div className="stock-adjustment-preview">
              <span>
                Cantidad anterior: <strong>{formatQuantity(adjustmentPreviousQuantity, adjustmentSelectedUnit)}</strong>
              </span>
              <span>
                Diferencia: <strong>{formatDelta(adjustmentDelta, adjustmentSelectedUnit)}</strong>
              </span>
              {adjustmentReservedQuantity > 0 ? (
                <span>
                  Reservado por pedidos (mínimo):{' '}
                  <strong>{formatQuantity(adjustmentReservedQuantity, adjustmentSelectedUnit)}</strong>
                </span>
              ) : null}
              <span>
                Unidad: <strong>{productUnitLabelByKey[adjustmentSelectedUnit]}</strong>
              </span>
            </div>

            <div className="products-form__actions">
              <Button type="submit" disabled={isSubmittingAdjustment}>
                {isSubmittingAdjustment ? 'Guardando...' : 'Confirmar ajuste'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setIsAdjustmentFormOpen(false)}>
                Cerrar
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel className="stock-panel" title="Inventario actual" action={inventoryLoadError ? undefined : <span>Total: {inventoryTotal}</span>}>
        <div className="stock-inventory__toolbar">
          <label className="field stock-inventory__search">
            Buscar por nombre o SKU
            <input
              type="search"
              value={inventorySearchTerm}
              onChange={(event) => setInventorySearchTerm(event.target.value)}
              placeholder="Ej: Harina, SKU-001"
            />
          </label>

          <label className="field stock-inventory__filter">
            Tipo de producto
            <select
              className="select-input"
              value={inventoryProductTypeFilter}
              onChange={(event) => {
                setInventoryProductTypeFilter(event.target.value as 'all' | ProductType)
                setInventoryPage(1)
              }}
            >
              <option value="all">Todos</option>
              <option value="raw_material">Materia prima</option>
              <option value="finished_product">Producto elaborado</option>
            </select>
          </label>
        </div>

        {inventoryLoadError ? (
          <LoadErrorState
            message={inventoryLoadError}
            onRetry={() => void loadInventory()}
            isRetrying={isLoadingInventory}
          />
        ) : null}
        {isLoadingInventory ? <p>Cargando inventario...</p> : null}
        {canShowInventoryEmpty ? <p>No hay productos para los filtros seleccionados.</p> : null}

        {!isLoadingInventory && balances.length > 0 ? (
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th>Categoría</th>
                  <th>Unidad</th>
                  <th className="numeric-cell">Cantidad</th>
                  <th className="numeric-cell">Reservado</th>
                  <th className="numeric-cell">Disponible</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((balance) => (
                  <tr key={`${balance.warehouseId}:${balance.productId}`}>
                    <td>{balance.productName}</td>
                    <td>
                      <StatusBadge tone={balance.productType === 'raw_material' ? 'warning' : 'success'}>
                        {productTypeLabelByKey[balance.productType]}
                      </StatusBadge>
                    </td>
                    <td>{balance.categoryName ?? 'Sin categoría'}</td>
                    <td>{productUnitLabelByKey[balance.unit]}</td>
                    <td className="numeric-cell">{formatQuantity(balance.quantity, balance.unit)}</td>
                    <td className="numeric-cell">{formatQuantity(balance.reservedQuantity, balance.unit)}</td>
                    <td className="numeric-cell">
                      <strong>{formatQuantity(balance.availableQuantity, balance.unit)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : null}

        {inventoryLoadError ? null : (
          <div className="products-pagination">
            <span>
              Página {inventoryPage} de {Math.max(inventoryTotalPages, 1)}
            </span>
            <div className="products-pagination__actions">
              <Button
                type="button"
                variant="secondary"
                disabled={inventoryPage <= 1}
                onClick={() => setInventoryPage((current) => current - 1)}
              >
                Anterior
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={inventoryTotalPages === 0 || inventoryPage >= inventoryTotalPages}
                onClick={() => setInventoryPage((current) => current + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <Panel className="stock-panel" title="Movimientos de stock">
        <div className="stock-history__filters stock-history__filters--movements">
          <label className="field stock-history__filter">
            Producto
            <select
              className="select-input"
              value={historyProductIdFilter}
              onChange={(event) => {
                setHistoryProductIdFilter(event.target.value)
                setMovementsPage(1)
              }}
            >
              <option value="">Todos</option>
              {adjustmentProductOptions.map((item) => (
                <option key={item.productId} value={item.productId}>
                  {item.productName}
                </option>
              ))}
            </select>
          </label>
          <label className="field stock-history__filter">
            Tipo
            <select
              className="select-input"
              value={historyMovementTypeFilter}
              onChange={(event) => {
                setHistoryMovementTypeFilter(event.target.value as '' | InventoryMovementType)
                setMovementsPage(1)
              }}
            >
              <option value="">Todos</option>
              <option value="purchase">Compra</option>
              <option value="adjustment">Ajuste</option>
              <option value="sale">Venta</option>
              <option value="production">Producción</option>
            </select>
          </label>
          <label className="field stock-history__filter">
            Desde
            <input
              type="date"
              value={historyFromDate}
              onChange={(event) => {
                setHistoryFromDate(event.target.value)
                setMovementsPage(1)
              }}
            />
          </label>
          <label className="field stock-history__filter">
            Hasta
            <input
              type="date"
              value={historyToDate}
              onChange={(event) => {
                setHistoryToDate(event.target.value)
                setMovementsPage(1)
              }}
            />
          </label>
        </div>

        {movementsLoadError ? (
          <LoadErrorState
            message={movementsLoadError}
            onRetry={() => void loadMovements()}
            isRetrying={isLoadingMovements}
          />
        ) : null}
        {isLoadingMovements ? <p>Cargando movimientos...</p> : null}
        {canShowMovementsEmpty ? <p>No hay movimientos para los filtros seleccionados.</p> : null}

        {!isLoadingMovements && movements.length > 0 ? (
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th className="numeric-cell">Cantidad</th>
                  <th className="numeric-cell">Saldo</th>
                  <th>Origen</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{new Date(movement.createdAt).toLocaleString('es-PY')}</td>
                    <td>{movement.productName}</td>
                    <td>
                      <StatusBadge tone={getMovementDisplay(movement).tone}>
                        {getMovementDisplay(movement).label}
                      </StatusBadge>
                    </td>
                    <td className="numeric-cell">{formatDelta(movement.quantityDelta, movement.unit)}</td>
                    <td className="numeric-cell">{formatQuantity(movement.balanceAfter, movement.unit)}</td>
                    <td>{movement.sourceReference ?? '—'}</td>
                    <td>{movement.createdByUserName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : null}

        {movementsLoadError ? null : (
          <div className="products-pagination">
            <span>
              Página {movementsPage} de {Math.max(movementsTotalPages, 1)}
            </span>
            <div className="products-pagination__actions">
              <Button
                type="button"
                variant="secondary"
                disabled={movementsPage <= 1}
                onClick={() => setMovementsPage((current) => current - 1)}
              >
                Anterior
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={movementsTotalPages === 0 || movementsPage >= movementsTotalPages}
                onClick={() => setMovementsPage((current) => current + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
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
