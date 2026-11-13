import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CartItemInput, Quote } from './api'

export type CartLine = CartItemInput & {
  name: string
  unit: string
  cutName: string | null
  unitPrice: number
}

export function lineKey(line: { productId: string; cutTypeId: string | null }) {
  return `${line.productId}:${line.cutTypeId ?? '-'}`
}

function storageKey(slug: string) {
  return `gastronexo:tienda:${slug}:carrito`
}

function readCart(slug: string): CartLine[] {
  try {
    const raw = window.localStorage.getItem(storageKey(slug))
    const parsed = raw ? (JSON.parse(raw) as CartLine[]) : []
    return Array.isArray(parsed) ? parsed.filter((line) => line.productId && line.quantity > 0) : []
  } catch {
    return []
  }
}

/** Carrito por tienda guardado en el navegador. El precio que vale es el del backend. */
export function useCart(slug: string) {
  const [lines, setLines] = useState<CartLine[]>(() => readCart(slug))
  const [lastRemoved, setLastRemoved] = useState<{ line: CartLine; index: number } | null>(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(slug), JSON.stringify(lines))
    } catch {
      // Sin almacenamiento (modo privado): el carrito dura lo que la pestaña.
    }
  }, [lines, slug])

  useEffect(() => {
    if (!lastRemoved) {
      return
    }
    const timer = window.setTimeout(() => setLastRemoved(null), 6000)
    return () => window.clearTimeout(timer)
  }, [lastRemoved])

  const add = useCallback((line: CartLine) => {
    setLines((current) => {
      const key = lineKey(line)
      const existing = current.find((candidate) => lineKey(candidate) === key)
      if (existing) {
        return current.map((candidate) =>
          lineKey(candidate) === key
            ? { ...candidate, quantity: Number((candidate.quantity + line.quantity).toFixed(3)) }
            : candidate,
        )
      }
      return [...current, line]
    })
  }, [])

  const remove = useCallback(
    (key: string) => {
      const index = lines.findIndex((line) => lineKey(line) === key)
      if (index >= 0) {
        setLastRemoved({ line: lines[index], index })
      }
      setLines((current) => current.filter((line) => lineKey(line) !== key))
    },
    [lines],
  )

  const setQuantity = useCallback(
    (key: string, quantity: number) => {
      if (quantity <= 0) {
        remove(key)
        return
      }
      setLines((current) =>
        current.map((line) => (lineKey(line) === key ? { ...line, quantity: Number(quantity.toFixed(3)) } : line)),
      )
    },
    [remove],
  )

  const undoRemove = useCallback(() => {
    if (!lastRemoved) {
      return
    }
    setLines((current) => {
      const next = [...current]
      next.splice(Math.min(lastRemoved.index, next.length), 0, lastRemoved.line)
      return next
    })
    setLastRemoved(null)
  }, [lastRemoved])

  /** Aplica precios y nombres vigentes de una cotizacion del backend. */
  const syncWithQuote = useCallback((quote: Quote) => {
    setLines((current) =>
      current.map((line) => {
        const fresh = quote.items.find((item) => lineKey(item) === lineKey(line))
        return fresh && fresh.unitPrice !== null && fresh.name
          ? { ...line, unitPrice: fresh.unitPrice, name: fresh.name, cutName: fresh.cutName }
          : line
      }),
    )
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPrice), 0)
    return { subtotal, count: lines.length }
  }, [lines])

  return { lines, add, remove, setQuantity, undoRemove, lastRemoved, syncWithQuote, clear, ...totals }
}

export type Cart = ReturnType<typeof useCart>
