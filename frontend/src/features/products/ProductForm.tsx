import { useEffect, useState } from 'react'
import { Button } from '../../shared/components'
import type { ProductCategory, ProductType, ProductUnit } from '../../shared/lib/auth-api'
import { productTypeCatalog } from './product-types'
import { productUnitCatalog } from './product-units'

export type ProductFormValues = {
  name: string
  sku: string
  unit: ProductUnit
  productType: ProductType
  cost: string
  categoryId: string
  isSellable: boolean
  isCatalogVisible: boolean
  salePrice: string
}

type ProductFormSubmitPayload = {
  name: string
  sku?: string
  unit: ProductUnit
  productType: ProductType
  cost: number
  categoryId: string | null
  isSellable: boolean
  isCatalogVisible: boolean
  salePrice: number | null
}

type ProductFormProps = {
  initialValues?: ProductFormValues
  categories: ProductCategory[]
  submitLabel: string
  isSubmitting: boolean
  onSubmit: (values: ProductFormSubmitPayload) => Promise<void>
  onCancel: () => void
}

const defaultValues: ProductFormValues = {
  name: '',
  sku: '',
  unit: 'unit',
  productType: 'raw_material',
  cost: '0',
  categoryId: '',
  isSellable: false,
  isCatalogVisible: false,
  salePrice: '',
}

export function ProductForm({
  initialValues = defaultValues,
  categories,
  submitLabel,
  isSubmitting,
  onSubmit,
  onCancel,
}: ProductFormProps) {
  const [values, setValues] = useState<ProductFormValues>(initialValues)
  const [errors, setErrors] = useState<Partial<Record<keyof ProductFormValues, string>>>({})

  useEffect(() => {
    setValues(initialValues)
    setErrors({})
  }, [initialValues])

  function setField<K extends keyof ProductFormValues>(field: K, value: ProductFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  function validate() {
    const nextErrors: Partial<Record<keyof ProductFormValues, string>> = {}
    const normalizedName = values.name.trim()
    const normalizedSku = values.sku.trim()
    const parsedCost = Number(values.cost)
    const parsedSalePrice = values.salePrice.trim() ? Number(values.salePrice) : null
    const hasCategorySelection = values.categoryId.trim().length > 0

    if (!normalizedName) {
      nextErrors.name = 'El nombre es obligatorio.'
    }

    if (normalizedName.length > 160) {
      nextErrors.name = 'El nombre no puede superar 160 caracteres.'
    }

    if (normalizedSku.length > 80) {
      nextErrors.sku = 'El SKU no puede superar 80 caracteres.'
    }

    if (!productUnitCatalog.some((entry) => entry.key === values.unit)) {
      nextErrors.unit = 'Seleccioná una unidad válida.'
    }

    if (!productTypeCatalog.some((entry) => entry.key === values.productType)) {
      nextErrors.productType = 'Seleccioná un tipo de producto válido.'
    }

    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      nextErrors.cost = 'El costo debe ser mayor o igual a 0.'
    }

    if (values.isCatalogVisible && !values.isSellable) {
      nextErrors.isCatalogVisible = 'Para mostrarse en catálogo, el producto debe ser vendible.'
    }

    if (parsedSalePrice !== null && (!Number.isFinite(parsedSalePrice) || parsedSalePrice < 0)) {
      nextErrors.salePrice = 'El precio de venta debe ser mayor o igual a 0.'
    }

    if (hasCategorySelection && !categories.some((category) => category.id === values.categoryId)) {
      nextErrors.categoryId = 'Seleccioná una categoría válida.'
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return null
    }

    return {
      name: normalizedName,
      sku: normalizedSku || undefined,
      unit: values.unit,
      productType: values.productType,
      cost: parsedCost,
      categoryId: hasCategorySelection ? values.categoryId : null,
      isSellable: values.isSellable,
      isCatalogVisible: values.isSellable ? values.isCatalogVisible : false,
      salePrice: values.isSellable ? parsedSalePrice : null,
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = validate()

    if (!payload) {
      return
    }

    await onSubmit(payload)
  }

  return (
    <form className="products-form" onSubmit={handleSubmit}>
      <label className="field">
        Nombre
        <input
          type="text"
          value={values.name}
          onChange={(event) => setField('name', event.target.value)}
          disabled={isSubmitting}
          required
        />
        {errors.name ? <span className="form-error">{errors.name}</span> : null}
      </label>

      <label className="field">
        SKU (opcional)
        <input
          type="text"
          value={values.sku}
          onChange={(event) => setField('sku', event.target.value)}
          disabled={isSubmitting}
        />
        {errors.sku ? <span className="form-error">{errors.sku}</span> : null}
      </label>

      <label className="field">
        Unidad
        <select
          className="select-input"
          value={values.unit}
          onChange={(event) => setField('unit', event.target.value as ProductUnit)}
          disabled={isSubmitting}
          required
        >
          {productUnitCatalog.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
        {errors.unit ? <span className="form-error">{errors.unit}</span> : null}
      </label>

      <label className="field">
        Tipo de producto
        <select
          className="select-input"
          value={values.productType}
          onChange={(event) => setField('productType', event.target.value as ProductType)}
          disabled={isSubmitting}
          required
        >
          {productTypeCatalog.map((entry) => (
            <option key={entry.key} value={entry.key}>
              {entry.label}
            </option>
          ))}
        </select>
        {errors.productType ? <span className="form-error">{errors.productType}</span> : null}
      </label>

      <label className="field">
        Categoría (opcional)
        <select
          className="select-input"
          value={values.categoryId}
          onChange={(event) => setField('categoryId', event.target.value)}
          disabled={isSubmitting}
        >
          <option value="">Sin categoría</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {errors.categoryId ? <span className="form-error">{errors.categoryId}</span> : null}
      </label>

      <label className="field">
        Costo
        <input
          type="number"
          min="0"
          step="0.01"
          value={values.cost}
          onChange={(event) => setField('cost', event.target.value)}
          disabled={isSubmitting}
          required
        />
        {errors.cost ? <span className="form-error">{errors.cost}</span> : null}
      </label>

      <fieldset className="products-form__section">
        <legend>Configuración comercial</legend>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={values.isSellable}
            onChange={(event) => {
              const checked = event.target.checked
              setValues((current) => ({
                ...current,
                isSellable: checked,
                isCatalogVisible: checked ? current.isCatalogVisible : false,
                salePrice: checked ? current.salePrice : '',
              }))
              setErrors((current) => ({
                ...current,
                isSellable: undefined,
                isCatalogVisible: undefined,
                salePrice: undefined,
              }))
            }}
            disabled={isSubmitting}
          />
          Vendible
        </label>

        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={values.isCatalogVisible}
            onChange={(event) => setField('isCatalogVisible', event.target.checked)}
            disabled={isSubmitting || !values.isSellable}
          />
          Visible en catálogo
        </label>

        <label className="field">
          Precio de venta
          <input
            type="number"
            min="0"
            step="0.01"
            value={values.salePrice}
            onChange={(event) => setField('salePrice', event.target.value)}
            disabled={isSubmitting || !values.isSellable}
          />
          {errors.salePrice ? <span className="form-error">{errors.salePrice}</span> : null}
        </label>
        {errors.isCatalogVisible ? (
          <span className="form-error">{errors.isCatalogVisible}</span>
        ) : null}
      </fieldset>

      <div className="products-form__actions">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Guardando...' : submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
