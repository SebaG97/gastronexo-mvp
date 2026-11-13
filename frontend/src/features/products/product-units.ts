import type { ProductUnit } from '../../shared/lib/auth-api'

export const productUnitCatalog: Array<{ key: ProductUnit; label: string }> = [
  { key: 'unit', label: 'Unidad' },
  { key: 'kg', label: 'Kilogramo' },
  { key: 'g', label: 'Gramo' },
  { key: 'l', label: 'Litro' },
  { key: 'ml', label: 'Mililitro' },
  { key: 'box', label: 'Caja' },
  { key: 'portion', label: 'Porción' },
]

export const productUnitLabelByKey = productUnitCatalog.reduce<Record<ProductUnit, string>>(
  (acc, entry) => {
    acc[entry.key] = entry.label
    return acc
  },
  {
    unit: 'Unidad',
    kg: 'Kilogramo',
    g: 'Gramo',
    l: 'Litro',
    ml: 'Mililitro',
    box: 'Caja',
    portion: 'Porción',
  },
)
