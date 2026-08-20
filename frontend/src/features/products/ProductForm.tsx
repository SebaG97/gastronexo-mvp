import { useEffect, useState } from 'react'
import { Button } from '../../shared/components'

export type ProductFormValues = {
  name: string
  sku: string
  unit: string
  cost: string
}

type ProductFormSubmitPayload = {
  name: string
  sku?: string
  unit: string
  cost: number
}

type ProductFormProps = {
  initialValues?: ProductFormValues
  submitLabel: string
  isSubmitting: boolean
  onSubmit: (values: ProductFormSubmitPayload) => Promise<void>
  onCancel: () => void
}

const defaultValues: ProductFormValues = {
  name: '',
  sku: '',
  unit: 'unit',
  cost: '0',
}

export function ProductForm({
  initialValues = defaultValues,
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
    const normalizedUnit = values.unit.trim()
    const parsedCost = Number(values.cost)

    if (!normalizedName) {
      nextErrors.name = 'El nombre es obligatorio.'
    }

    if (normalizedName.length > 160) {
      nextErrors.name = 'El nombre no puede superar 160 caracteres.'
    }

    if (normalizedSku.length > 80) {
      nextErrors.sku = 'El SKU no puede superar 80 caracteres.'
    }

    if (!normalizedUnit) {
      nextErrors.unit = 'La unidad es obligatoria.'
    }

    if (normalizedUnit.length > 24) {
      nextErrors.unit = 'La unidad no puede superar 24 caracteres.'
    }

    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      nextErrors.cost = 'El costo debe ser mayor o igual a 0.'
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return null
    }

    return {
      name: normalizedName,
      sku: normalizedSku || undefined,
      unit: normalizedUnit,
      cost: parsedCost,
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
        <input
          type="text"
          value={values.unit}
          onChange={(event) => setField('unit', event.target.value)}
          disabled={isSubmitting}
          required
        />
        {errors.unit ? <span className="form-error">{errors.unit}</span> : null}
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
