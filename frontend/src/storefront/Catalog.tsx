import { Minus, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveMediaUrl } from '../shared/lib/media'
import type { CatalogProduct, Category } from './api'
import { formatAmount, formatMoney, formatQuantity, perUnitLabel, quantityStep } from './format'
import { lineKey, type Cart } from './useCart'

type Sort = 'name' | 'price_asc' | 'price_desc'

const tints = ['leaf', 'tomato', 'citrus', 'root', 'plum'] as const
type Tint = (typeof tints)[number]

// Color por rubro, para que el catalogo se lea de un vistazo aunque todavia no haya fotos.
const tintByKeyword: Array<[RegExp, Tint]> = [
  [/hoja|hierba|verde|lechuga/i, 'leaf'],
  [/verdura|hortaliza/i, 'tomato'],
  [/fruta|citric/i, 'citrus'],
  [/precortad|preparad|cocina|salsa/i, 'plum'],
  [/tub[eé]rculo|ra[ií]z/i, 'root'],
]

export function tintForCategory(name: string | null) {
  if (name) {
    for (const [pattern, tint] of tintByKeyword) {
      if (pattern.test(name)) {
        return tint
      }
    }
  }
  let hash = 0
  for (const char of name ?? '') {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return tints[hash % tints.length]
}

function tintFor(product: CatalogProduct) {
  return tintForCategory(product.categoryName ?? product.name)
}

export function ProductThumb({ product, size = 'card' }: { product: CatalogProduct; size?: 'card' | 'sheet' }) {
  const [failed, setFailed] = useState(false)
  if (product.imageUrl && !failed) {
    return (
      <img
        className={`sf-thumb sf-thumb--${size}`}
        src={resolveMediaUrl(product.imageUrl) ?? undefined}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div className={`sf-thumb sf-thumb--${size} sf-thumb--${tintFor(product)}`} aria-hidden="true">
      <span>{product.name.charAt(0)}</span>
    </div>
  )
}

function PriceTag({ price, unit }: { price: number; unit: string }) {
  return (
    <p className="sf-tag">
      <span className="sf-tag__currency">Gs.</span>
      <span className="sf-tag__amount">{formatAmount(price)}</span>
      <span className="sf-tag__unit">{perUnitLabel(unit)}</span>
    </p>
  )
}

function Stepper({
  value,
  unit,
  onChange,
  label,
}: {
  value: number
  unit: string
  onChange: (next: number) => void
  label: string
}) {
  const step = quantityStep(unit)
  return (
    <div className="sf-stepper" role="group" aria-label={`Cantidad de ${label}`}>
      <button type="button" onClick={() => onChange(Number((value - step).toFixed(3)))} aria-label="Quitar">
        <Minus size={16} strokeWidth={2.5} />
      </button>
      <output aria-live="polite">{formatQuantity(value, unit)}</output>
      <button type="button" onClick={() => onChange(Number((value + step).toFixed(3)))} aria-label="Agregar">
        <Plus size={16} strokeWidth={2.5} />
      </button>
    </div>
  )
}

function ProductSheet({ product, cart, onClose }: { product: CatalogProduct; cart: Cart; onClose: () => void }) {
  const defaultCut = product.cuts.find((cut) => cut.isDefault) ?? product.cuts[0] ?? null
  const [cutId, setCutId] = useState<string | null>(defaultCut?.id ?? null)
  const [quantity, setQuantity] = useState(quantityStep(product.unit))
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cut = product.cuts.find((candidate) => candidate.id === cutId) ?? null
  const unitPrice = Number(product.price) + Number(cut?.priceModifier ?? 0)
  const isOut = product.availability === 'out_of_stock'

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="sf-sheet"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close()
        }
      }}
      aria-labelledby="sf-sheet-title"
    >
      <div className="sf-sheet__body">
        <button className="sf-icon-btn sf-sheet__close" type="button" onClick={() => dialogRef.current?.close()} aria-label="Cerrar">
          <X size={20} />
        </button>
        <ProductThumb product={product} size="sheet" />
        <h2 id="sf-sheet-title">{product.name}</h2>
        {product.description && <p className="sf-sheet__description">{product.description}</p>}
        <PriceTag price={unitPrice} unit={product.unit} />

        {product.cuts.length > 0 && (
          <fieldset className="sf-choices">
            <legend>¿Cómo lo querés?</legend>
            {product.cuts.map((option) => (
              <label key={option.id} className="sf-choice">
                <input
                  type="radio"
                  name="cut"
                  value={option.id}
                  checked={cutId === option.id}
                  onChange={() => setCutId(option.id)}
                />
                <span>{option.name}</span>
                <small>{Number(option.priceModifier) > 0 ? `+ ${formatMoney(option.priceModifier)}` : 'Sin recargo'}</small>
              </label>
            ))}
          </fieldset>
        )}

        {isOut ? (
          <p className="sf-note">Hoy no tenemos este producto.</p>
        ) : (
          <div className="sf-sheet__actions">
            <Stepper
              value={quantity}
              unit={product.unit}
              label={product.name}
              onChange={(next) => setQuantity(Math.max(quantityStep(product.unit), next))}
            />
            <button
              className="sf-btn sf-btn--primary sf-btn--wide"
              type="button"
              onClick={() => {
                cart.add({
                  productId: product.id,
                  cutTypeId: cut?.id ?? null,
                  quantity,
                  name: product.name,
                  unit: product.unit,
                  cutName: cut?.name ?? null,
                  unitPrice,
                })
                dialogRef.current?.close()
              }}
            >
              Agregar {formatMoney(Math.round(unitPrice * quantity))}
            </button>
          </div>
        )}
      </div>
    </dialog>
  )
}

function ProductCard({ product, cart, onOpen }: { product: CatalogProduct; cart: Cart; onOpen: () => void }) {
  const hasCuts = product.cuts.length > 0
  const isOut = product.availability === 'out_of_stock'
  const lines = cart.lines.filter((line) => line.productId === product.id)
  const simpleLine = !hasCuts ? lines[0] : undefined
  const inCart = lines.reduce((sum, line) => sum + line.quantity, 0)

  return (
    <li className={`sf-product${isOut ? ' sf-product--out' : ''}${inCart > 0 ? ' is-in-cart' : ''}`}>
      <div className="sf-product__media">
        <button className="sf-product__open" type="button" onClick={onOpen} aria-label={`Ver ${product.name}`}>
          <ProductThumb product={product} />
        </button>
        {product.availability === 'last_units' && <span className="sf-sticker">Quedan pocas</span>}
        {isOut && <span className="sf-sticker sf-sticker--out">Sin stock hoy</span>}
        {hasCuts && inCart > 0 && (
          <span className="sf-sticker sf-sticker--cart">{formatQuantity(inCart, product.unit)} en tu pedido</span>
        )}
        <PriceTag price={Number(product.price)} unit={product.unit} />
      </div>
      <div className="sf-product__info">
        <h3>
          <button type="button" onClick={onOpen}>
            {product.name}
          </button>
        </h3>
        {product.description && <p className="sf-product__description">{product.description}</p>}
        {hasCuts && <p className="sf-product__cuts">{product.cuts.map((cut) => cut.name).join(', ')}</p>}
      </div>
      <div className="sf-product__action">
        {isOut ? null : simpleLine ? (
          <Stepper
            value={simpleLine.quantity}
            unit={product.unit}
            label={product.name}
            onChange={(next) => cart.setQuantity(lineKey(simpleLine), next)}
          />
        ) : hasCuts ? (
          <button className="sf-btn sf-btn--add" type="button" onClick={onOpen}>
            {inCart > 0 ? 'Agregar otro corte' : 'Elegir corte'}
          </button>
        ) : (
          <button
            className="sf-btn sf-btn--add"
            type="button"
            onClick={() =>
              cart.add({
                productId: product.id,
                cutTypeId: null,
                quantity: quantityStep(product.unit),
                name: product.name,
                unit: product.unit,
                cutName: null,
                unitPrice: Number(product.price),
              })
            }
          >
            Agregar
          </button>
        )}
      </div>
    </li>
  )
}

export function Catalog({
  products,
  categories,
  cart,
}: {
  products: CatalogProduct[]
  categories: Category[]
  cart: Cart
}) {
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('name')
  const [openProductId, setOpenProductId] = useState<string | null>(null)
  const openProduct = products.find((product) => product.id === openProductId) ?? null

  const visible = useMemo(() => {
    const term = query
      .trim()
      .toLocaleLowerCase('es')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
    const filtered = products.filter((product) => {
      if (categoryId && product.categoryId !== categoryId) {
        return false
      }
      if (!term) {
        return true
      }
      const haystack = `${product.name} ${product.description ?? ''}`
        .toLocaleLowerCase('es')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
      return haystack.includes(term)
    })
    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'price_asc') return Number(a.price) - Number(b.price)
      if (sort === 'price_desc') return Number(b.price) - Number(a.price)
      return a.name.localeCompare(b.name, 'es')
    })
    // Sin stock al final: primero lo que se puede pedir.
    return sorted.sort((a, b) => Number(a.availability === 'out_of_stock') - Number(b.availability === 'out_of_stock'))
  }, [products, query, categoryId, sort])

  const groups = useMemo(() => {
    if (categoryId || query.trim() || sort !== 'name') {
      return [{ id: 'all', name: null as string | null, items: visible }]
    }
    const byCategory = new Map<string, { id: string; name: string | null; items: CatalogProduct[] }>()
    for (const product of visible) {
      const key = product.categoryId ?? 'otros'
      const group = byCategory.get(key) ?? { id: key, name: product.categoryName ?? 'Otros', items: [] }
      group.items.push(product)
      byCategory.set(key, group)
    }
    return [...byCategory.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es'))
  }, [visible, categoryId, query, sort])

  return (
    <main className="sf-catalog" id="catalogo">
      <div className="sf-tools">
        <label className="sf-search">
          <Search size={18} aria-hidden="true" />
          <span className="sf-visually-hidden">Buscar productos</span>
          <input
            type="search"
            placeholder="Buscar productos"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="sf-sort">
          <span className="sf-visually-hidden">Ordenar</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            <option value="name">De la A a la Z</option>
            <option value="price_asc">Menor precio</option>
            <option value="price_desc">Mayor precio</option>
          </select>
        </label>
      </div>

      <nav className="sf-categories" aria-label="Categorías">
        <button type="button" aria-pressed={categoryId === null} onClick={() => setCategoryId(null)}>
          Todo <span>{products.length}</span>
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            aria-pressed={categoryId === category.id}
            onClick={() => setCategoryId(category.id)}
          >
            <i className={`sf-dot sf-dot--${tintForCategory(category.name)}`} aria-hidden="true" />
            {category.name} <span>{category.productCount}</span>
          </button>
        ))}
      </nav>

      {visible.length === 0 ? (
        <div className="sf-empty">
          <p>
            {query.trim()
              ? `No encontramos “${query.trim()}”. Probá con otra palabra o mirá todas las categorías.`
              : 'Todavía no hay productos en esta categoría.'}
          </p>
          <button
            className="sf-btn"
            type="button"
            onClick={() => {
              setQuery('')
              setCategoryId(null)
            }}
          >
            Ver todos los productos
          </button>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.id} className="sf-group" aria-label={group.name ?? 'Resultados'}>
            {group.name && (
              <h2 className={`sf-group__title sf-group__title--${tintForCategory(group.name)}`}>
                {group.name} <span>{group.items.length}</span>
              </h2>
            )}
            <ul className="sf-products">
              {group.items.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  cart={cart}
                  onOpen={() => setOpenProductId(product.id)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {openProduct && <ProductSheet key={openProduct.id} product={openProduct} cart={cart} onClose={() => setOpenProductId(null)} />}
    </main>
  )
}
