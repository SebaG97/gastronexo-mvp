import { useEffect, useState, type FormEvent } from 'react'
import { Button, LoadErrorState, Panel, StatusBadge, TableScroll } from '../../shared/components'
import { NotificationsPanel } from './NotificationsPanel'
import {
  createDeliveryZone,
  getStorefrontSettings,
  updateDeliveryZone,
  updateStorefrontSettings,
  type DeliveryZone,
  type StorefrontPaymentMethod,
  type StorefrontSettings,
  type StorefrontSettingsInput,
} from '../../shared/lib/auth-api'

type StorefrontSettingsViewProps = {
  token: string
  canManage: boolean
}

const paymentOptions: Array<{ value: StorefrontPaymentMethod; label: string }> = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'card_on_delivery', label: 'Tarjeta al recibir' },
]

const moneyFormatter = new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 })

function toForm(settings: StorefrontSettings): StorefrontSettingsInput {
  return {
    isEnabled: settings.isEnabled,
    displayName: settings.displayName ?? '',
    tagline: settings.tagline ?? '',
    contactPhone: settings.contactPhone ?? '',
    whatsappPhone: settings.whatsappPhone ?? '',
    contactEmail: settings.contactEmail ?? '',
    pickupAddress: settings.pickupAddress ?? '',
    openingHours: settings.openingHours ?? '',
    cutoffNotice: settings.cutoffNotice ?? '',
    minOrderAmount: Number(settings.minOrderAmount),
    allowsPickup: settings.allowsPickup,
    allowsDelivery: settings.allowsDelivery,
    paymentMethods: settings.paymentMethods,
    transferDetails: settings.transferDetails ?? '',
  }
}

export function StorefrontSettingsView({ token, canManage }: StorefrontSettingsViewProps) {
  const [settings, setSettings] = useState<StorefrontSettings | null>(null)
  const [zones, setZones] = useState<DeliveryZone[]>([])
  const [form, setForm] = useState<StorefrontSettingsInput | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [zoneName, setZoneName] = useState('')
  const [zoneFee, setZoneFee] = useState('')
  const [copied, setCopied] = useState(false)

  async function load() {
    setIsLoading(true)
    setLoadError(null)
    try {
      const response = await getStorefrontSettings(token)
      setSettings(response.settings)
      setZones(response.zones)
      setForm(toForm(response.settings))
    } catch {
      setLoadError('No se pudo cargar la configuración de la tienda.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  function update<K extends keyof StorefrontSettingsInput>(key: K, value: StorefrontSettingsInput[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current))
    setMessage(null)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form) {
      return
    }
    setIsSaving(true)
    setMessage(null)
    try {
      const response = await updateStorefrontSettings(form, token)
      setSettings(response.settings)
      setZones(response.zones)
      setForm(toForm(response.settings))
      setMessage({ tone: 'success', text: 'Configuración guardada.' })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo guardar.' })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleAddZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (zoneName.trim().length < 2 || zoneFee === '') {
      setMessage({ tone: 'error', text: 'Completá el nombre y el costo de la zona.' })
      return
    }
    try {
      const response = await createDeliveryZone({ name: zoneName.trim(), fee: Number(zoneFee), sortOrder: zones.length }, token)
      setZones(response.zones)
      setZoneName('')
      setZoneFee('')
      setMessage({ tone: 'success', text: 'Zona agregada.' })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo agregar la zona.' })
    }
  }

  async function handleToggleZone(zone: DeliveryZone) {
    try {
      const response = await updateDeliveryZone(zone.id, { isActive: !zone.isActive }, token)
      setZones(response.zones)
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo actualizar la zona.' })
    }
  }

  async function handleZoneFee(zone: DeliveryZone, value: string) {
    const fee = Number(value)
    if (!Number.isFinite(fee) || fee < 0 || fee === Number(zone.fee)) {
      return
    }
    try {
      const response = await updateDeliveryZone(zone.id, { fee }, token)
      setZones(response.zones)
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'No se pudo actualizar la zona.' })
    }
  }

  const storeUrl = settings ? `${window.location.origin}/tienda/${settings.slug}` : ''
  const disabled = !canManage || isSaving

  return (
    <main className="page" aria-busy={isLoading}>
      <div className="page-header">
        <div>
          <h1>Tienda online</h1>
          <p>Lo que ve el cliente al comprar desde el link público. Los pedidos entran a Pedidos como nuevos.</p>
        </div>
      </div>

      {loadError ? <LoadErrorState message={loadError} onRetry={() => void load()} isRetrying={isLoading} /> : null}
      {isLoading && !settings ? <p>Cargando configuración...</p> : null}

      {settings && form ? (
        <>
          <Panel
            title="Link de la tienda"
            action={
              <StatusBadge tone={settings.isEnabled ? 'success' : 'warning'}>
                {settings.isEnabled ? 'Publicada' : 'Sin publicar'}
              </StatusBadge>
            }
          >
            <div className="storefront-link">
              <code>{storeUrl}</code>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(storeUrl).then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 2000)
                  })
                }}
              >
                {copied ? 'Copiado' : 'Copiar link'}
              </Button>
              {settings.isEnabled ? (
                <a className="button button--secondary storefront-link__open" href={storeUrl} target="_blank" rel="noreferrer">
                  Abrir tienda
                </a>
              ) : null}
            </div>
            {!settings.isEnabled ? (
              <p className="purchase-detail-notes">Mientras no la publiques, el link muestra que la tienda no está disponible.</p>
            ) : null}
            {!canManage ? <p className="purchase-detail-notes">Solo owner o admin pueden cambiar la configuración.</p> : null}
          </Panel>

          <NotificationsPanel token={token} canManage={canManage} />

          <Panel title="Datos y reglas de venta">
            <form className="storefront-settings-form" onSubmit={handleSave}>
              <div className="storefront-settings-checks">
                <label>
                  <input type="checkbox" checked={form.isEnabled} disabled={disabled} onChange={(event) => update('isEnabled', event.target.checked)} />
                  Tienda publicada
                </label>
                <label>
                  <input type="checkbox" checked={form.allowsDelivery} disabled={disabled} onChange={(event) => update('allowsDelivery', event.target.checked)} />
                  Hace envíos
                </label>
                <label>
                  <input type="checkbox" checked={form.allowsPickup} disabled={disabled} onChange={(event) => update('allowsPickup', event.target.checked)} />
                  Retiro en el local
                </label>
              </div>

              <div className="storefront-settings-grid">
                <label className="field">
                  Nombre visible
                  <input value={form.displayName ?? ''} disabled={disabled} placeholder={settings.organizationName} onChange={(event) => update('displayName', event.target.value)} />
                </label>
                <label className="field">
                  Pedido mínimo (Gs., sin envío)
                  <input inputMode="numeric" value={form.minOrderAmount} disabled={disabled} onChange={(event) => update('minOrderAmount', Number(event.target.value.replace(/\D/g, '')) || 0)} />
                </label>
                <label className="field">
                  Teléfono
                  <input value={form.contactPhone ?? ''} disabled={disabled} onChange={(event) => update('contactPhone', event.target.value)} />
                </label>
                <label className="field">
                  WhatsApp (con código de país)
                  <input value={form.whatsappPhone ?? ''} disabled={disabled} placeholder="595981123456" onChange={(event) => update('whatsappPhone', event.target.value)} />
                </label>
                <label className="field">
                  Correo
                  <input type="email" value={form.contactEmail ?? ''} disabled={disabled} onChange={(event) => update('contactEmail', event.target.value)} />
                </label>
                <label className="field">
                  Dirección de retiro
                  <input value={form.pickupAddress ?? ''} disabled={disabled} onChange={(event) => update('pickupAddress', event.target.value)} />
                </label>
                <label className="field">
                  Horario
                  <input value={form.openingHours ?? ''} disabled={disabled} placeholder="Lunes a sábado de 6:00 a 14:00" onChange={(event) => update('openingHours', event.target.value)} />
                </label>
                <label className="field">
                  Aviso de entregas
                  <input value={form.cutoffNotice ?? ''} disabled={disabled} placeholder="Pedidos después de las 15:00 salen al día siguiente" onChange={(event) => update('cutoffNotice', event.target.value)} />
                </label>
              </div>

              <label className="field">
                Frase de portada
                <input value={form.tagline ?? ''} disabled={disabled} maxLength={200} onChange={(event) => update('tagline', event.target.value)} />
              </label>

              <fieldset className="storefront-settings-fieldset" disabled={disabled}>
                <legend>Formas de pago (se cobran al entregar)</legend>
                <div className="storefront-settings-checks">
                  {paymentOptions.map((option) => (
                    <label key={option.value}>
                      <input
                        type="checkbox"
                        checked={form.paymentMethods.includes(option.value)}
                        onChange={(event) =>
                          update(
                            'paymentMethods',
                            event.target.checked
                              ? [...form.paymentMethods, option.value]
                              : form.paymentMethods.filter((method) => method !== option.value),
                          )
                        }
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {form.paymentMethods.includes('transfer') ? (
                <label className="field">
                  Datos para transferencia
                  <input value={form.transferDetails ?? ''} disabled={disabled} placeholder="Banco, cuenta, RUC" onChange={(event) => update('transferDetails', event.target.value)} />
                </label>
              ) : null}

              {message ? (
                <p className={`members-message members-message--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
                  {message.text}
                </p>
              ) : null}

              {canManage ? (
                <div className="products-form__actions">
                  <Button type="submit" disabled={isSaving || form.paymentMethods.length === 0}>
                    {isSaving ? 'Guardando...' : 'Guardar configuración'}
                  </Button>
                </div>
              ) : null}
            </form>
          </Panel>

          <Panel title="Zonas de envío" action={<span>Activas: {zones.filter((zone) => zone.isActive).length}</span>}>
            {zones.length === 0 ? <p>Sin zonas: la tienda solo ofrece retiro hasta que agregues al menos una.</p> : null}
            {zones.length > 0 ? (
              <TableScroll>
                <table className="products-table">
                  <thead>
                    <tr>
                      <th>Zona</th>
                      <th>Costo</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zones.map((zone) => (
                      <tr key={zone.id}>
                        <td>{zone.name}</td>
                        <td>
                          {canManage ? (
                            <input
                              className="select-input"
                              inputMode="numeric"
                              defaultValue={Number(zone.fee)}
                              aria-label={`Costo de envío a ${zone.name}`}
                              onBlur={(event) => void handleZoneFee(zone, event.target.value)}
                            />
                          ) : (
                            moneyFormatter.format(Number(zone.fee))
                          )}
                        </td>
                        <td>
                          <StatusBadge tone={zone.isActive ? 'success' : 'warning'}>{zone.isActive ? 'Activa' : 'Inactiva'}</StatusBadge>
                        </td>
                        <td className="products-table__actions">
                          {canManage ? (
                            <Button type="button" variant="secondary" onClick={() => void handleToggleZone(zone)}>
                              {zone.isActive ? 'Desactivar' : 'Activar'}
                            </Button>
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
            {canManage ? (
              <form className="storefront-zone-form" onSubmit={handleAddZone}>
                <label className="field">
                  Nueva zona
                  <input value={zoneName} onChange={(event) => setZoneName(event.target.value)} placeholder="Barrio o ciudad" />
                </label>
                <label className="field">
                  Costo (Gs.)
                  <input inputMode="numeric" value={zoneFee} onChange={(event) => setZoneFee(event.target.value.replace(/\D/g, ''))} />
                </label>
                <Button type="submit">Agregar zona</Button>
              </form>
            ) : null}
          </Panel>
        </>
      ) : null}
    </main>
  )
}
