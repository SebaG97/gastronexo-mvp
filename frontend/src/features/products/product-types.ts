import type { ProductType } from '../../shared/lib/auth-api'

export const productTypeCatalog: Array<{ key: ProductType; label: string }> = [
  { key: 'raw_material', label: 'Materia prima' },
  { key: 'finished_product', label: 'Producto elaborado' },
]

export const productTypeLabelByKey = productTypeCatalog.reduce<Record<ProductType, string>>(
  (acc, entry) => {
    acc[entry.key] = entry.label
    return acc
  },
  {
    raw_material: 'Materia prima',
    finished_product: 'Producto elaborado',
  },
)
