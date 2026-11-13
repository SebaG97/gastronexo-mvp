import { useCallback, useEffect, useState } from 'react'
import { storeApi, type CatalogProduct, type Category, type Store, StoreApiError } from './api'
import { CartPanel } from './CartPanel'
import { Catalog } from './Catalog'
import { Checkout } from './Checkout'
import { Confirmation } from './Confirmation'
import { formatAmount, formatMoney } from './format'
import { useCart } from './useCart'
import './storefront.css'

type Route = { view: 'catalog' } | { view: 'checkout' } | { view: 'order'; token: string }

function parseRoute(pathname: string): { slug: string; route: Route } {
  const [, , slug = '', section, token] = pathname.split('/')
  if (section === 'pedido' && token) {
    return { slug, route: { view: 'order', token } }
  }
  if (section === 'finalizar') {
    return { slug, route: { view: 'checkout' } }
  }
  return { slug, route: { view: 'catalog' } }
}

export function StorefrontApp() {
  const [{ slug, route }, setLocation] = useState(() => parseRoute(window.location.pathname))
  const [store, setStore] = useState<Store | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [loadError, setLoadError] = useState<StoreApiError | null>(null)
  const [isCartOpen, setIsCartOpen] = useState(false)
  const cart = useCart(slug)

  const navigate = useCallback(
    (next: Route) => {
      const path =
        next.view === 'order'
          ? `/tienda/${slug}/pedido/${next.token}`
          : next.view === 'checkout'
            ? `/tienda/${slug}/finalizar`
            : `/tienda/${slug}`
      window.history.pushState(null, '', path)
      setLocation({ slug, route: next })
      setIsCartOpen(false)
      window.scrollTo({ top: 0 })
    },
    [slug],
  )

  useEffect(() => {
    const onPopState = () => setLocation(parseRoute(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [storeResponse, categoriesResponse, productsResponse] = await Promise.all([
        storeApi.store(slug),
        storeApi.categories(slug),
        storeApi.products(slug),
      ])
      setStore(storeResponse.store)
      setCategories(categoriesResponse.categories)
      setProducts(productsResponse.products)
      document.title = storeResponse.store.name
    } catch (error) {
      setLoadError(error instanceof StoreApiError ? error : new StoreApiError(0, null, 'Algo salió mal.', null))
    }
  }, [slug])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    document.body.classList.toggle('sf-locked', isCartOpen)
  }, [isCartOpen])

  if (loadError) {
    const notFound = loadError.status === 404
    return (
      <div className="sf">
        <main className="sf-state">
          <h1>{notFound ? 'Esta tienda no está disponible' : 'No pudimos abrir la tienda'}</h1>
          <p>
            {notFound
              ? 'Revisá el enlace o pedile al comercio que te lo vuelva a enviar.'
              : loadError.message}
          </p>
          {!notFound && (
            <button className="sf-btn sf-btn--primary" type="button" onClick={() => void load()}>
              Volver a intentar
            </button>
          )}
        </main>
      </div>
    )
  }

  if (!store) {
    return (
      <div className="sf">
        <main className="sf-state" aria-busy="true">
          <p>Abriendo la tienda…</p>
        </main>
      </div>
    )
  }

  const minOrder = Number(store.minOrderAmount)
  const cheapestDelivery =
    store.allowsDelivery && store.deliveryZones.length > 0
      ? Math.min(...store.deliveryZones.map((zone) => Number(zone.fee)))
      : null

  return (
    <div className="sf">
      <header className="sf-header">
        <div className="sf-header__bar">
          <a
            className="sf-brand"
            href={`/tienda/${slug}`}
            onClick={(event) => {
              event.preventDefault()
              navigate({ view: 'catalog' })
            }}
          >
            {store.name}
          </a>
          {route.view === 'catalog' && (
            <button
              className="sf-cart-button"
              type="button"
              onClick={() => setIsCartOpen(true)}
              aria-label={`Ver pedido, ${cart.count} productos`}
            >
              {/* La key cambia con cada agregado: el contador salta para confirmar la accion. */}
              <span key={cart.lines.reduce((sum, line) => sum + line.quantity, 0)} className="sf-cart-button__count">
                {cart.count}
              </span>
              <span className="sf-cart-button__label">
                {cart.count === 0 ? 'Tu pedido' : formatMoney(cart.subtotal)}
              </span>
            </button>
          )}
        </div>
        {route.view === 'catalog' && (
          <div className="sf-board">
            <div className="sf-board__hero">
              {store.tagline && <p className="sf-board__tagline">{store.tagline}</p>}
              {cheapestDelivery !== null ? (
                <p className="sf-board__tag">
                  <span>Envío desde</span>
                  <strong>
                    <small>Gs.</small>
                    {formatAmount(cheapestDelivery)}
                  </strong>
                  <span>{store.allowsPickup ? 'o retirás sin costo' : 'según tu zona'}</span>
                </p>
              ) : store.allowsPickup ? (
                <p className="sf-board__tag">
                  <span>Retiro</span>
                  <strong>Sin costo</strong>
                  <span>en el local</span>
                </p>
              ) : null}
            </div>
            <dl className="sf-board__facts">
              {store.openingHours && (
                <div>
                  <dt>Horario</dt>
                  <dd>{store.openingHours}</dd>
                </div>
              )}
              {store.cutoffNotice && (
                <div>
                  <dt>Entregas</dt>
                  <dd>{store.cutoffNotice}</dd>
                </div>
              )}
              {minOrder > 0 && (
                <div>
                  <dt>Pedido mínimo</dt>
                  <dd>{formatMoney(minOrder)}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </header>

      {route.view === 'catalog' && (
        <div className="sf-shop">
          <Catalog products={products} categories={categories} cart={cart} />
          <CartPanel
            store={store}
            cart={cart}
            isOpen={isCartOpen}
            onClose={() => setIsCartOpen(false)}
            onCheckout={() => navigate({ view: 'checkout' })}
          />
          {cart.count > 0 && (
            <button className="sf-mobile-cart" type="button" onClick={() => setIsCartOpen(true)}>
              <span>
                Ver pedido <small>({cart.count} {cart.count === 1 ? 'producto' : 'productos'})</small>
              </span>
              <strong>{formatMoney(cart.subtotal)}</strong>
            </button>
          )}
        </div>
      )}

      {route.view === 'checkout' && (
        <Checkout
          slug={slug}
          store={store}
          cart={cart}
          onBack={() => navigate({ view: 'catalog' })}
          onPlaced={(token) => {
            cart.clear()
            navigate({ view: 'order', token })
          }}
        />
      )}

      {route.view === 'order' && (
        <Confirmation slug={slug} store={store} token={route.token} onContinue={() => navigate({ view: 'catalog' })} />
      )}

      <footer className="sf-footer">
        <p>{store.name}</p>
        {store.pickupAddress && <p>{store.pickupAddress}</p>}
        {store.contactPhone && (
          <p>
            Teléfono <a href={`tel:${store.contactPhone.replace(/\s/g, '')}`}>{store.contactPhone}</a>
          </p>
        )}
        {store.contactEmail && (
          <p>
            <a href={`mailto:${store.contactEmail}`}>{store.contactEmail}</a>
          </p>
        )}
      </footer>
    </div>
  )
}
