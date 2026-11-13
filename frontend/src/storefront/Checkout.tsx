import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { storeApi, StoreApiError, type FulfillmentType, type PaymentMethod, type Store } from './api'
import { issueFor, useCartQuote } from './CartPanel'
import { formatMoney, formatQuantity, paymentLabels } from './format'
import { lineKey, type Cart } from './useCart'

const steps = ['Tus datos', 'Entrega', 'Pago', 'Revisión'] as const

type Form = {
  name: string
  phone: string
  email: string
  fulfillment: FulfillmentType
  zoneId: string
  address: string
  reference: string
  requestedDate: string
  payment: PaymentMethod
  cashChangeFor: string
  notes: string
  website: string
}

const contactStorageKey = 'gastronexo:tienda:contacto'

function readSavedContact(): Partial<Form> {
  try {
    return JSON.parse(window.localStorage.getItem(contactStorageKey) ?? '{}') as Partial<Form>
  } catch {
    return {}
  }
}

function today() {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

function newAttemptKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function Checkout({
  slug,
  store,
  cart,
  onBack,
  onPlaced,
}: {
  slug: string
  store: Store
  cart: Cart
  onBack: () => void
  onPlaced: (token: string) => void
}) {
  const saved = useMemo(readSavedContact, [])
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [attemptKey, setAttemptKey] = useState(newAttemptKey)
  const [form, setForm] = useState<Form>(() => ({
    name: saved.name ?? '',
    phone: saved.phone ?? '',
    email: saved.email ?? '',
    fulfillment: store.allowsDelivery ? 'delivery' : 'pickup',
    zoneId: saved.zoneId && store.deliveryZones.some((zone) => zone.id === saved.zoneId) ? saved.zoneId : '',
    address: saved.address ?? '',
    reference: saved.reference ?? '',
    requestedDate: '',
    payment: store.paymentMethods[0] ?? 'cash',
    cashChangeFor: '',
    notes: '',
    website: '',
  }))

  const { quote, isQuoting } = useCartQuote(slug, cart, {
    fulfillmentType: form.fulfillment,
    deliveryZoneId: form.fulfillment === 'delivery' ? form.zoneId || null : null,
  })

  // Un carrito distinto es un intento de compra distinto.
  const cartSignature = cart.lines.map((line) => `${lineKey(line)}=${line.quantity}`).join('|')
  useEffect(() => {
    setAttemptKey(newAttemptKey())
  }, [cartSignature])

  useEffect(() => {
    if (cart.lines.length === 0 && !isSubmitting) {
      onBack()
    }
  }, [cart.lines.length, isSubmitting, onBack])

  const zone = store.deliveryZones.find((candidate) => candidate.id === form.zoneId) ?? null
  const deliveryFee = form.fulfillment === 'delivery' && zone ? Number(zone.fee) : 0
  const subtotal = quote?.subtotal ?? cart.subtotal
  const total = quote?.total ?? subtotal + deliveryFee

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  function validate(target: number) {
    const next: Partial<Record<keyof Form, string>> = {}
    if (target === 0) {
      if (form.name.trim().length < 2) next.name = 'Escribí tu nombre.'
      if (form.phone.replace(/\D/g, '').length < 6) next.phone = 'Escribí un teléfono donde te podamos llamar.'
      if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'Revisá el correo.'
    }
    if (target === 1 && form.fulfillment === 'delivery') {
      if (!form.zoneId) next.zoneId = 'Elegí tu zona.'
      if (form.address.trim().length < 5) next.address = 'Escribí la dirección de entrega.'
    }
    if (target === 2 && form.payment === 'cash' && form.cashChangeFor) {
      if (Number(form.cashChangeFor) < total) next.cashChangeFor = `Tiene que cubrir el total de ${formatMoney(total)}.`
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function goTo(target: number) {
    if (target > step) {
      for (let index = step; index < target; index += 1) {
        if (!validate(index)) {
          setStep(index)
          return
        }
      }
    }
    setSubmitError(null)
    setStep(target)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (step < steps.length - 1) {
      goTo(step + 1)
      return
    }
    if (![0, 1, 2].every(validate)) {
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      window.localStorage.setItem(
        contactStorageKey,
        JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
          zoneId: form.zoneId,
          address: form.address,
          reference: form.reference,
        }),
      )
    } catch {
      // Sin almacenamiento: la próxima vez se vuelven a pedir los datos.
    }

    try {
      const response = await storeApi.createOrder(
        slug,
        {
          contact: { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() || null },
          fulfillment: {
            type: form.fulfillment,
            deliveryZoneId: form.fulfillment === 'delivery' ? form.zoneId : null,
            address: form.fulfillment === 'delivery' ? form.address.trim() : null,
            reference: form.fulfillment === 'delivery' ? form.reference.trim() || null : null,
            requestedDate: form.requestedDate || null,
          },
          payment: {
            method: form.payment,
            cashChangeFor: form.payment === 'cash' && form.cashChangeFor ? Number(form.cashChangeFor) : null,
          },
          notes: form.notes.trim() || null,
          items: cart.lines.map(({ productId, cutTypeId, quantity }) => ({ productId, cutTypeId, quantity })),
          expectedTotal: total,
          website: form.website,
        },
        attemptKey,
      )
      onPlaced(response.order.publicToken)
    } catch (error) {
      setIsSubmitting(false)
      if (error instanceof StoreApiError) {
        if (error.quote) {
          cart.syncWithQuote(error.quote)
        }
        setSubmitError(
          error.code === 'price_changed' && error.quote
            ? `Los precios cambiaron. El nuevo total es ${formatMoney(error.quote.total)}. Revisalo y enviá de nuevo.`
            : error.message,
        )
        return
      }
      setSubmitError('No pudimos enviar el pedido. Probá de nuevo.')
    }
  }

  return (
    <main className="sf-checkout">
      <button className="sf-back" type="button" onClick={step === 0 ? onBack : () => goTo(step - 1)}>
        <ArrowLeft size={18} /> {step === 0 ? 'Volver a la tienda' : `Volver a ${steps[step - 1].toLowerCase()}`}
      </button>

      <ol className="sf-steps" aria-label="Pasos para finalizar">
        {steps.map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined} className={index < step ? 'is-done' : undefined}>
            <button type="button" onClick={() => goTo(index)} disabled={index > step}>
              <span className="sf-steps__n">{index + 1}</span>
              <span className="sf-steps__label">{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="sf-checkout__grid">
        <form className="sf-form" onSubmit={submit} noValidate>
          {/* Honeypot: invisible para personas. */}
          <input
            className="sf-hp"
            tabIndex={-1}
            autoComplete="off"
            name="website"
            value={form.website}
            onChange={(event) => update('website', event.target.value)}
            aria-hidden="true"
          />

          {step === 0 && (
            <fieldset>
              <legend>¿A nombre de quién va el pedido?</legend>
              <Field label="Nombre y apellido" error={errors.name}>
                <input value={form.name} autoComplete="name" onChange={(event) => update('name', event.target.value)} />
              </Field>
              <Field label="Teléfono o WhatsApp" hint="Te escribimos si hay que confirmar algo." error={errors.phone}>
                <input
                  value={form.phone}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0981 123 456"
                  onChange={(event) => update('phone', event.target.value)}
                />
              </Field>
              <Field label="Correo (opcional)" error={errors.email}>
                <input
                  value={form.email}
                  type="email"
                  autoComplete="email"
                  onChange={(event) => update('email', event.target.value)}
                />
              </Field>
            </fieldset>
          )}

          {step === 1 && (
            <fieldset>
              <legend>¿Cómo lo recibís?</legend>
              <div className="sf-options">
                {store.allowsDelivery && (
                  <label className="sf-option">
                    <input
                      type="radio"
                      name="fulfillment"
                      checked={form.fulfillment === 'delivery'}
                      onChange={() => update('fulfillment', 'delivery')}
                    />
                    <span>
                      <strong>Envío a domicilio</strong>
                      <small>El costo depende de tu zona.</small>
                    </span>
                  </label>
                )}
                {store.allowsPickup && (
                  <label className="sf-option">
                    <input
                      type="radio"
                      name="fulfillment"
                      checked={form.fulfillment === 'pickup'}
                      onChange={() => update('fulfillment', 'pickup')}
                    />
                    <span>
                      <strong>Retiro en el local</strong>
                      <small>{store.pickupAddress ?? 'Sin costo.'}</small>
                    </span>
                  </label>
                )}
              </div>

              {form.fulfillment === 'delivery' && (
                <>
                  <Field label="Zona" error={errors.zoneId}>
                    <select value={form.zoneId} onChange={(event) => update('zoneId', event.target.value)}>
                      <option value="">Elegí tu zona</option>
                      {store.deliveryZones.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name} ({formatMoney(option.fee)})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Dirección" error={errors.address}>
                    <input
                      value={form.address}
                      autoComplete="street-address"
                      placeholder="Calle, número y barrio"
                      onChange={(event) => update('address', event.target.value)}
                    />
                  </Field>
                  <Field label="Referencia (opcional)">
                    <input
                      value={form.reference}
                      placeholder="Portón verde, frente a la plaza…"
                      onChange={(event) => update('reference', event.target.value)}
                    />
                  </Field>
                </>
              )}

              <Field label="¿Para qué día? (opcional)" hint={store.cutoffNotice ?? undefined}>
                <input
                  type="date"
                  min={today()}
                  value={form.requestedDate}
                  onChange={(event) => update('requestedDate', event.target.value)}
                />
              </Field>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset>
              <legend>¿Cómo vas a pagar?</legend>
              <p className="sf-form__note">Pagás al recibir o al retirar. No cobramos nada por la web.</p>
              <div className="sf-options">
                {store.paymentMethods.map((method) => (
                  <label key={method} className="sf-option">
                    <input
                      type="radio"
                      name="payment"
                      checked={form.payment === method}
                      onChange={() => update('payment', method)}
                    />
                    <span>
                      <strong>{paymentLabels[method]}</strong>
                      {method === 'transfer' && store.transferDetails && <small>{store.transferDetails}</small>}
                    </span>
                  </label>
                ))}
              </div>
              {form.payment === 'cash' && (
                <Field label="¿Con cuánto vas a pagar? (opcional)" hint="Así llevamos el vuelto justo." error={errors.cashChangeFor}>
                  <input
                    inputMode="numeric"
                    value={form.cashChangeFor}
                    placeholder={String(Math.ceil(total / 10000) * 10000)}
                    onChange={(event) => update('cashChangeFor', event.target.value.replace(/\D/g, ''))}
                  />
                </Field>
              )}
            </fieldset>
          )}

          {step === 3 && (
            <fieldset>
              <legend>Revisá y enviá</legend>
              <dl className="sf-review">
                <div>
                  <dt>Nombre</dt>
                  <dd>
                    {form.name}, {form.phone}
                  </dd>
                </div>
                <div>
                  <dt>Entrega</dt>
                  <dd>
                    {form.fulfillment === 'delivery'
                      ? `${form.address}${form.reference ? ` (${form.reference})` : ''}, ${zone?.name ?? ''}`
                      : `Retiro en ${store.pickupAddress ?? 'el local'}`}
                    {form.requestedDate && `. Para el ${new Date(`${form.requestedDate}T12:00:00`).toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                  </dd>
                </div>
                <div>
                  <dt>Pago</dt>
                  <dd>
                    {paymentLabels[form.payment]}
                    {form.payment === 'cash' && form.cashChangeFor && `, pagás con ${formatMoney(form.cashChangeFor)}`}
                  </dd>
                </div>
              </dl>
              <Field label="Notas para el pedido (opcional)" hint={`${form.notes.length}/500`}>
                <textarea
                  value={form.notes}
                  maxLength={500}
                  rows={3}
                  placeholder="Tomates no muy maduros, llamar al llegar…"
                  onChange={(event) => update('notes', event.target.value)}
                />
              </Field>
            </fieldset>
          )}

          {submitError && (
            <p className="sf-alert" role="alert">
              {submitError}
            </p>
          )}

          <button
            className="sf-btn sf-btn--primary sf-btn--wide sf-btn--big"
            type="submit"
            disabled={isSubmitting || (step === steps.length - 1 && (isQuoting || (quote?.hasIssues ?? false)))}
          >
            {step < steps.length - 1
              ? 'Continuar'
              : isSubmitting
                ? 'Enviando pedido…'
                : `Enviar pedido de ${formatMoney(total)}`}
          </button>
        </form>

        <aside className="sf-summary" aria-label="Resumen del pedido">
          <h2>Resumen</h2>
          <ul>
            {cart.lines.map((line) => {
              const issue = issueFor(quote, lineKey(line))
              return (
                <li key={lineKey(line)} className={issue ? 'has-issue' : undefined}>
                  <span>
                    {formatQuantity(line.quantity, line.unit)} {line.name}
                    {line.cutName && <small> en {line.cutName.toLowerCase()}</small>}
                    {issue && <em>{issue}</em>}
                  </span>
                  <span>{formatMoney(Math.round(line.quantity * line.unitPrice))}</span>
                </li>
              )
            })}
          </ul>
          <div className="sf-sum">
            <span>Productos</span>
            <span>{formatMoney(subtotal)}</span>
          </div>
          <div className="sf-sum">
            <span>Envío</span>
            <span>
              {form.fulfillment === 'pickup' ? 'Sin costo' : zone ? formatMoney(deliveryFee) : 'Elegí tu zona'}
            </span>
          </div>
          <div className="sf-sum sf-sum--total">
            <span>Total</span>
            <strong>{formatMoney(total)}</strong>
          </div>
          {quote?.hasIssues && (
            <p className="sf-alert">
              Algunos productos cambiaron.{' '}
              <button type="button" className="sf-link" onClick={onBack}>
                Volvé a la tienda
              </button>{' '}
              para ajustarlos.
            </p>
          )}
        </aside>
      </div>
    </main>
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className={`sf-field${error ? ' has-error' : ''}`}>
      <span className="sf-field__label">{label}</span>
      {children}
      {error ? <span className="sf-field__error">{error}</span> : hint ? <span className="sf-field__hint">{hint}</span> : null}
    </label>
  )
}
