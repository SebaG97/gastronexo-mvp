// Mision 9.1: detalle del pedido en un panel (pantalla completa en celular), con contacto directo
// (WhatsApp, llamar, mapa) y el boton del proximo paso fijo abajo.
import { MapPin, MessageCircle, Phone } from 'lucide-react'
import { useState } from 'react'
import { Button, Modal, StatusBadge } from '../../shared/components'
import type { InsufficientStockError, OrderDetail, OrderStatus, Warehouse } from '../../shared/lib/auth-api'
import { productUnitLabelByKey } from '../products/product-units'
import {
  cancelReasons,
  formatMoney,
  formatQuantity,
  mapsLink,
  nextStatusByStatus,
  paymentLabelByKey,
  phoneLink,
  statusLabelByKey,
  statusToneByKey,
  transitionActionByStatus,
  whatsappLink,
} from './orders-format'

export function StockShortageNotice({ error }: { error: InsufficientStockError }) {
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

type OrderDetailSheetProps = {
  order: OrderDetail | null
  isLoading: boolean
  transitions: OrderStatus[]
  canWrite: boolean
  warehouses: Warehouse[]
  dispatchWarehouseId: string
  onDispatchWarehouseChange: (warehouseId: string) => void
  pendingStatus: OrderStatus | null
  stockError: InsufficientStockError | null
  errorMessage: string | null
  onAdvance: (nextStatus: OrderStatus) => void
  onCancel: (reason: string) => Promise<boolean>
  onEdit: () => void
  onClose: () => void
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString('es-PY') : 'Sin fecha'
}

export function OrderDetailSheet({
  order,
  isLoading,
  transitions,
  canWrite,
  warehouses,
  dispatchWarehouseId,
  onDispatchWarehouseChange,
  pendingStatus,
  stockError,
  errorMessage,
  onAdvance,
  onCancel,
  onEdit,
  onClose,
}: OrderDetailSheetProps) {
  const [isCancelOpen, setIsCancelOpen] = useState(false)

  if (!order) {
    return (
      <Modal open={isLoading} onClose={onClose} title="Cargando pedido…" variant="drawer">
        <p>Cargando…</p>
      </Modal>
    )
  }

  const nextStatus = nextStatusByStatus[order.status]
  const canAdvance = canWrite && nextStatus !== undefined && transitions.includes(nextStatus)
  const canCancel = canWrite && transitions.includes('cancelled')
  const canEdit = canWrite && (order.status === 'new' || order.status === 'confirmed')
  // Un pedido sin deposito lo elige al confirmar (ahi se reserva el stock). Con uno solo, se usa ese.
  const needsWarehouse = canAdvance && order.warehouseId === null
  const phone = order.contactPhone ?? order.customerPhone
  const contactName = order.contactName ?? order.customerName
  const address = order.fulfillmentType === 'delivery' ? order.deliveryAddress : null

  return (
    <>
      <Modal
        open
        onClose={onClose}
        variant="drawer"
        className="order-sheet"
        title={
          <>
            {order.orderNumber} <StatusBadge tone={statusToneByKey[order.status]}>{statusLabelByKey[order.status]}</StatusBadge>
          </>
        }
        subtitle={`${order.channel === 'storefront' ? 'Tienda online' : 'Carga interna'} · ${new Date(order.createdAt).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' })}`}
        footer={
          canWrite && (canAdvance || canCancel || canEdit) ? (
            <div className="order-sheet__footer">
              <div className="order-sheet__secondary">
                {canEdit ? (
                  <Button type="button" variant="secondary" onClick={onEdit}>
                    Editar
                  </Button>
                ) : null}
                {canCancel ? (
                  <Button type="button" variant="secondary" className="button--text-danger" onClick={() => setIsCancelOpen(true)}>
                    Cancelar pedido
                  </Button>
                ) : null}
              </div>
              {canAdvance ? (
                <Button
                  type="button"
                  className="order-sheet__primary"
                  disabled={pendingStatus !== null}
                  onClick={() => onAdvance(nextStatus!)}
                >
                  {pendingStatus === nextStatus ? 'Actualizando…' : transitionActionByStatus[nextStatus!]}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      >
        <section className="order-sheet__section order-sheet__contact">
          <div>
            <p className="order-sheet__label">Cliente</p>
            <p className="order-sheet__value">{contactName}</p>
            {phone ? <p className="order-sheet__muted">{phone}</p> : null}
          </div>
          <div className="order-sheet__contact-actions">
            {phone ? (
              <>
                <a
                  className="contact-button contact-button--whatsapp"
                  href={whatsappLink(phone, `Hola ${contactName}, te escribimos por tu pedido ${order.orderNumber}.`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle size={18} aria-hidden="true" /> WhatsApp
                </a>
                <a className="contact-button" href={phoneLink(phone)}>
                  <Phone size={18} aria-hidden="true" /> Llamar
                </a>
              </>
            ) : null}
            {address ? (
              <a className="contact-button" href={mapsLink(address)} target="_blank" rel="noreferrer">
                <MapPin size={18} aria-hidden="true" /> Mapa
              </a>
            ) : null}
          </div>
        </section>

        <section className="order-sheet__section">
          <dl className="order-sheet__facts">
            <div>
              <dt>Entrega</dt>
              <dd>
                {order.fulfillmentType === 'delivery'
                  ? `Envío${order.deliveryZoneName ? ` · ${order.deliveryZoneName}` : ''}`
                  : order.fulfillmentType === 'pickup'
                    ? 'Retira en el local'
                    : 'A coordinar'}
              </dd>
            </div>
            <div>
              <dt>Fecha pedida</dt>
              <dd>{formatDate(order.requestedDeliveryDate)}</dd>
            </div>
            {address ? (
              <div className="order-sheet__facts-wide">
                <dt>Dirección</dt>
                <dd>
                  {address}
                  {order.deliveryReference ? <span className="order-sheet__muted"> · {order.deliveryReference}</span> : null}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Pago</dt>
              <dd>
                {order.paymentMethod ? paymentLabelByKey[order.paymentMethod] : 'Sin indicar'}
                {order.cashChangeFor ? <span className="order-sheet__muted"> · paga con {formatMoney(order.cashChangeFor)}</span> : null}
              </dd>
            </div>
            <div>
              <dt>Depósito</dt>
              <dd>{order.warehouseName ?? 'Sin asignar'}</dd>
            </div>
          </dl>
          {order.notes ? <p className="order-sheet__notes">{order.notes}</p> : null}
        </section>

        <section className="order-sheet__section">
          <p className="order-sheet__label">Productos</p>
          <ul className="order-sheet__items">
            {order.items.map((item) => (
              <li key={item.id}>
                <span className="order-sheet__item-qty">
                  {formatQuantity(item.quantity)} {productUnitLabelByKey[item.productUnitSnapshot]}
                </span>
                <span className="order-sheet__item-name">
                  {item.productNameSnapshot}
                  {item.cutNameSnapshot ? <span className="order-sheet__muted"> · {item.cutNameSnapshot}</span> : null}
                </span>
                <span className="order-sheet__item-total">{formatMoney(item.subtotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="order-sheet__totals">
            {Number(order.deliveryFee) > 0 ? (
              <>
                <div>
                  <dt>Productos</dt>
                  <dd>{formatMoney(order.subtotal)}</dd>
                </div>
                <div>
                  <dt>Envío</dt>
                  <dd>{formatMoney(order.deliveryFee)}</dd>
                </div>
              </>
            ) : null}
            <div className="order-sheet__total">
              <dt>Total</dt>
              <dd>{formatMoney(order.total)}</dd>
            </div>
          </dl>
        </section>

        {needsWarehouse && warehouses.length > 1 ? (
          <section className="order-sheet__section">
            <label className="field">
              Depósito de despacho (al confirmar se reserva el stock)
              <select className="select-input" value={dispatchWarehouseId} onChange={(event) => onDispatchWarehouseChange(event.target.value)}>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
        ) : null}

        {stockError ? <StockShortageNotice error={stockError} /> : null}
        {errorMessage ? (
          <p className="members-message members-message--error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <section className="order-sheet__section">
          <p className="order-sheet__label">Historial</p>
          <ol className="order-sheet__history">
            {order.history.map((entry) => (
              <li key={entry.id}>
                <strong>{statusLabelByKey[entry.toStatus]}</strong>
                <span className="order-sheet__muted">
                  {' '}
                  · {entry.changedByUserName ?? 'la tienda online'} ·{' '}
                  {new Date(entry.createdAt).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
                {entry.note ? <span className="order-sheet__history-note">{entry.note}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      </Modal>

      <CancelOrderDialog
        open={isCancelOpen}
        orderNumber={order.orderNumber}
        isPending={pendingStatus === 'cancelled'}
        onClose={() => setIsCancelOpen(false)}
        onConfirm={async (reason) => {
          const ok = await onCancel(reason)
          if (ok) setIsCancelOpen(false)
        }}
      />
    </>
  )
}

type CancelOrderDialogProps = {
  open: boolean
  orderNumber: string
  isPending: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
}

function CancelOrderDialog({ open, orderNumber, isPending, onClose, onConfirm }: CancelOrderDialogProps) {
  const [reason, setReason] = useState(cancelReasons[0])
  const [detail, setDetail] = useState('')
  const finalReason = reason === 'Otro motivo' ? detail.trim() : detail.trim() ? `${reason}: ${detail.trim()}` : reason
  const canConfirm = finalReason.length > 0 && !isPending

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="dialog"
      title={`¿Cancelar ${orderNumber}?`}
      subtitle="Si tenía stock reservado, se libera. No se puede deshacer."
      footer={
        <div className="order-sheet__footer">
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" variant="danger" disabled={!canConfirm} onClick={() => onConfirm(finalReason.slice(0, 300))}>
            {isPending ? 'Cancelando…' : 'Sí, cancelar pedido'}
          </Button>
        </div>
      }
    >
      <fieldset className="cancel-reasons">
        <legend>Motivo</legend>
        {cancelReasons.map((option) => (
          <label key={option} className={`cancel-reason${reason === option ? ' cancel-reason--active' : ''}`}>
            <input type="radio" name="cancel-reason" value={option} checked={reason === option} onChange={() => setReason(option)} />
            {option}
          </label>
        ))}
      </fieldset>
      <label className="field">
        {reason === 'Otro motivo' ? 'Contá qué pasó' : 'Detalle (opcional)'}
        <textarea rows={2} maxLength={250} value={detail} onChange={(event) => setDetail(event.target.value)} />
      </label>
    </Modal>
  )
}
