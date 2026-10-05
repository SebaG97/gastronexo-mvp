import { useEffect, useMemo, useState } from 'react'
import { Button, StatusBadge, TableScroll } from '../../shared/components'
import {
  ApiError,
  createProductCutOption,
  getCutTypes,
  getProductCutOptions,
  updateProductCutOption,
  type CutType,
  type Product,
  type ProductCutOption,
} from '../../shared/lib/auth-api'

type ProductCutOptionsManagerProps = {
  token: string
  product: Product
  canWriteProducts: boolean
}

export function ProductCutOptionsManager({
  token,
  product,
  canWriteProducts,
}: ProductCutOptionsManagerProps) {
  const [cutTypes, setCutTypes] = useState<CutType[]>([])
  const [cutOptions, setCutOptions] = useState<ProductCutOption[]>([])
  const [selectedCutTypeId, setSelectedCutTypeId] = useState('')
  const [priceModifier, setPriceModifier] = useState('0')
  const [makeDefault, setMakeDefault] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const availableCutTypes = useMemo(() => {
    const assignedCutTypeIds = new Set(cutOptions.map((option) => option.cutTypeId))
    return cutTypes.filter((cutType) => !assignedCutTypeIds.has(cutType.id))
  }, [cutOptions, cutTypes])

  async function loadData() {
    setErrorMessage(null)
    setIsLoading(true)

    try {
      const [cutTypesResponse, cutOptionsResponse] = await Promise.all([
        getCutTypes({ status: 'active' }, token),
        getProductCutOptions(product.id, token),
      ])

      setCutTypes(cutTypesResponse.cutTypes)
      setCutOptions(cutOptionsResponse.cutOptions)
      setSelectedCutTypeId((current) => {
        const assignedCutTypeIds = new Set(cutOptionsResponse.cutOptions.map((option) => option.cutTypeId))
        if (
          current &&
          !assignedCutTypeIds.has(current) &&
          cutTypesResponse.cutTypes.some((cutType) => cutType.id === current)
        ) {
          return current
        }

        return cutTypesResponse.cutTypes.find((cutType) => !assignedCutTypeIds.has(cutType.id))?.id ?? ''
      })
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudieron cargar los cortes del producto.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [product.id, token])

  async function handleAddCutOption(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedCutTypeId || !canWriteProducts) {
      return
    }

    const parsedPriceModifier = Number(priceModifier || '0')
    if (!Number.isFinite(parsedPriceModifier) || parsedPriceModifier < 0) {
      setErrorMessage('El modificador de precio debe ser mayor o igual a 0.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setIsSubmitting(true)

    try {
      const response = await createProductCutOption(
        product.id,
        {
          cutTypeId: selectedCutTypeId,
          isDefault: makeDefault,
          priceModifier: parsedPriceModifier,
        },
        token,
      )

      setCutOptions(response.cutOptions)
      setSelectedCutTypeId(() => {
        const assignedCutTypeIds = new Set(response.cutOptions.map((option) => option.cutTypeId))
        return cutTypes.find((cutType) => !assignedCutTypeIds.has(cutType.id))?.id ?? ''
      })
      setPriceModifier('0')
      setMakeDefault(false)
      setSuccessMessage('Corte asignado correctamente.')
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo asignar el corte.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleUpdateOption(
    option: ProductCutOption,
    input: { isDefault?: boolean; isActive?: boolean },
  ) {
    if (!canWriteProducts) {
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)
    setPendingOptionId(option.id)

    try {
      const response = await updateProductCutOption(product.id, option.id, input, token)
      setCutOptions(response.cutOptions)
      setSuccessMessage('Configuración de corte actualizada.')
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'No se pudo actualizar el corte.')
    } finally {
      setPendingOptionId(null)
    }
  }

  return (
    <div className="product-cuts">
      {isLoading ? <p>Cargando cortes del producto...</p> : null}

      {!isLoading && cutOptions.length === 0 ? (
        <p>No hay cortes asociados a este producto.</p>
      ) : null}

      {!isLoading && cutOptions.length > 0 ? (
        <TableScroll>
          <table className="products-table">
            <thead>
              <tr>
                <th>Corte</th>
                <th>Default</th>
                <th>Estado</th>
                <th>Tipo global</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cutOptions.map((option) => (
                <tr key={option.id}>
                  <td>{option.cutTypeName}</td>
                  <td>{option.isDefault && option.isActive ? 'Sí' : 'No'}</td>
                  <td>
                    <StatusBadge tone={option.isActive ? 'success' : 'warning'}>
                      {option.isActive ? 'Activo' : 'Inactivo'}
                    </StatusBadge>
                  </td>
                  <td>
                    <StatusBadge tone={option.cutTypeIsActive ? 'success' : 'warning'}>
                      {option.cutTypeIsActive ? 'Activo' : 'Inactivo'}
                    </StatusBadge>
                  </td>
                  <td className="products-table__actions">
                    {canWriteProducts ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={
                            pendingOptionId === option.id ||
                            !option.isActive ||
                            !option.cutTypeIsActive ||
                            option.isDefault
                          }
                          onClick={() => void handleUpdateOption(option, { isDefault: true })}
                        >
                          Marcar default
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={pendingOptionId === option.id || (!option.cutTypeIsActive && !option.isActive)}
                          onClick={() => void handleUpdateOption(option, { isActive: !option.isActive })}
                        >
                          {option.isActive ? 'Inactivar' : 'Activar'}
                        </Button>
                      </>
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

      {canWriteProducts && product.isActive ? (
        <form className="product-cuts__form" onSubmit={handleAddCutOption}>
          <label className="field">
            Agregar corte
            <select
              className="select-input"
              value={selectedCutTypeId}
              onChange={(event) => setSelectedCutTypeId(event.target.value)}
              disabled={isSubmitting || availableCutTypes.length === 0}
            >
              {availableCutTypes.length === 0 ? (
                <option value="">Sin cortes activos disponibles</option>
              ) : (
                availableCutTypes.map((cutType) => (
                  <option key={cutType.id} value={cutType.id}>
                    {cutType.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="field">
            Modificador
            <input
              type="number"
              min="0"
              step="0.01"
              value={priceModifier}
              onChange={(event) => setPriceModifier(event.target.value)}
              disabled={isSubmitting || availableCutTypes.length === 0}
            />
          </label>

          <label className="checkbox-field product-cuts__default">
            <input
              type="checkbox"
              checked={makeDefault}
              onChange={(event) => setMakeDefault(event.target.checked)}
              disabled={isSubmitting || availableCutTypes.length === 0}
            />
            Default
          </label>

          <Button type="submit" disabled={isSubmitting || availableCutTypes.length === 0}>
            {isSubmitting ? 'Guardando...' : 'Agregar'}
          </Button>
        </form>
      ) : null}

      {canWriteProducts && !product.isActive ? (
        <p className="products-table__no-actions">
          El producto está inactivo; no acepta nueva configuración comercial.
        </p>
      ) : null}

      {errorMessage ? (
        <p className="members-message members-message--error" role="alert" aria-live="polite">
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p className="members-message members-message--success" role="status" aria-live="polite">
          {successMessage}
        </p>
      ) : null}
    </div>
  )
}
