import { useEffect, useRef, useState } from 'react'
import { Button, LoadErrorState, Panel, StatusBadge, TableScroll } from '../../shared/components'
import {
  ApiError,
  createProductionRun,
  createRecipe,
  getInsufficientStockError,
  getProductionRunById,
  getProductionRuns,
  getProducts,
  getRecipeById,
  getRecipes,
  getWarehouses,
  previewProductionRun,
  updateRecipe,
  updateRecipeStatus,
  voidProductionRun,
  type InsufficientStockError,
  type Product,
  type ProductionPreview,
  type ProductionRun,
  type ProductionRunDetail,
  type ProductionRunStatus,
  type ProductUnit,
  type Recipe,
  type RecipeDetail,
  type RecipesStatusFilter,
  type Warehouse,
} from '../../shared/lib/auth-api'

const RUNS_PAGE_SIZE = 10
const RECIPES_PAGE_SIZE = 8

const moneyFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const quantityFormatter = new Intl.NumberFormat('es-PY', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

const unitShortLabel: Record<ProductUnit, string> = {
  unit: 'u.',
  kg: 'kg',
  g: 'g',
  l: 'l',
  ml: 'ml',
  box: 'cajas',
  portion: 'porc.',
}

const runStatusDisplay: Record<ProductionRunStatus, { label: string; tone: 'success' | 'danger' }> = {
  completed: { label: 'Completada', tone: 'success' },
  voided: { label: 'Anulada', tone: 'danger' },
}

type ProductionViewProps = {
  token: string
  canWriteProduction: boolean
  createRequestId: number
}

type RecipeFormItem = {
  ingredientProductId: string
  quantity: string
}

type RecipeFormMode = { type: 'closed' } | { type: 'create' } | { type: 'edit'; recipe: RecipeDetail }

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; preview: ProductionPreview }
  | { status: 'error'; message: string }

function formatMoney(value: string | number) {
  const numericValue = Number(value)
  return `Gs. ${moneyFormatter.format(Number.isFinite(numericValue) ? Math.round(numericValue) : 0)}`
}

function formatQuantity(value: string | number, unit?: ProductUnit) {
  const numericValue = Number(value)
  const formatted = quantityFormatter.format(Number.isFinite(numericValue) ? numericValue : 0)
  return unit ? `${formatted} ${unitShortLabel[unit]}` : formatted
}

function emptyToNull(value: string) {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function errorMessageOf(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback
}

function StockShortageNotice({ error }: { error: InsufficientStockError }) {
  return (
    <div className="stock-shortage" role="alert">
      <p>{error.message} No se registró nada.</p>
      <ul>
        {error.shortages.map((shortage) => (
          <li key={shortage.productId}>
            <strong>{shortage.productName}</strong>: necesario {formatQuantity(shortage.requested, shortage.unit)} ·
            disponible {formatQuantity(shortage.available, shortage.unit)} · faltan{' '}
            <strong>{formatQuantity(shortage.missing, shortage.unit)}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ProductionView({ token, canWriteProduction, createRequestId }: ProductionViewProps) {
  const [runs, setRuns] = useState<ProductionRun[]>([])
  const [runsPage, setRunsPage] = useState(1)
  const [runsTotal, setRunsTotal] = useState(0)
  const [runsTotalPages, setRunsTotalPages] = useState(0)
  const [runsStatus, setRunsStatus] = useState<ProductionRunStatus | 'all'>('all')
  const [runsSearch, setRunsSearch] = useState('')
  const [debouncedRunsSearch, setDebouncedRunsSearch] = useState('')
  const [isLoadingRuns, setIsLoadingRuns] = useState(true)
  const [runsLoadError, setRunsLoadError] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<ProductionRunDetail | null>(null)
  const [isLoadingRunDetail, setIsLoadingRunDetail] = useState(false)
  const [isVoidConfirmOpen, setIsVoidConfirmOpen] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [isVoiding, setIsVoiding] = useState(false)

  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipesPage, setRecipesPage] = useState(1)
  const [recipesTotal, setRecipesTotal] = useState(0)
  const [recipesTotalPages, setRecipesTotalPages] = useState(0)
  const [recipesStatus, setRecipesStatus] = useState<RecipesStatusFilter>('all')
  const [recipesSearch, setRecipesSearch] = useState('')
  const [debouncedRecipesSearch, setDebouncedRecipesSearch] = useState('')
  const [isLoadingRecipes, setIsLoadingRecipes] = useState(true)
  const [recipesLoadError, setRecipesLoadError] = useState<string | null>(null)
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeDetail | null>(null)
  const [pendingRecipeId, setPendingRecipeId] = useState<string | null>(null)

  const [recipeFormMode, setRecipeFormMode] = useState<RecipeFormMode>({ type: 'closed' })
  const [recipeProductId, setRecipeProductId] = useState('')
  const [recipeYield, setRecipeYield] = useState('1')
  const [recipeNotes, setRecipeNotes] = useState('')
  const [recipeItems, setRecipeItems] = useState<RecipeFormItem[]>([{ ingredientProductId: '', quantity: '1' }])
  const [isSubmittingRecipe, setIsSubmittingRecipe] = useState(false)

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [finishedProducts, setFinishedProducts] = useState<Product[]>([])
  const [rawMaterials, setRawMaterials] = useState<Product[]>([])
  const [activeRecipes, setActiveRecipes] = useState<Recipe[]>([])
  const [optionsLoadError, setOptionsLoadError] = useState<string | null>(null)

  const [isProductionFormOpen, setIsProductionFormOpen] = useState(false)
  const [productionProductId, setProductionProductId] = useState('')
  const [productionWarehouseId, setProductionWarehouseId] = useState('')
  const [productionQuantity, setProductionQuantity] = useState('')
  const [productionNotes, setProductionNotes] = useState('')
  const [previewState, setPreviewState] = useState<PreviewState>({ status: 'idle' })
  const [isSubmittingProduction, setIsSubmittingProduction] = useState(false)
  const [productionStockError, setProductionStockError] = useState<InsufficientStockError | null>(null)
  const previewRequestRef = useRef(0)

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedRunsSearch(runsSearch.trim())
      setRunsPage(1)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [runsSearch])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedRecipesSearch(recipesSearch.trim())
      setRecipesPage(1)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [recipesSearch])

  useEffect(() => {
    if (createRequestId > 0 && canWriteProduction) {
      openProductionForm()
    }
  }, [canWriteProduction, createRequestId])

  async function loadRuns() {
    setIsLoadingRuns(true)
    setRunsLoadError(null)

    try {
      const response = await getProductionRuns(
        { status: runsStatus, q: debouncedRunsSearch || undefined, page: runsPage, pageSize: RUNS_PAGE_SIZE },
        token,
      )
      setRuns(response.productionRuns)
      setRunsTotal(response.pagination.total)
      setRunsTotalPages(response.pagination.totalPages)
    } catch {
      setRunsLoadError('No se pudieron cargar las producciones.')
      setRuns([])
    } finally {
      setIsLoadingRuns(false)
    }
  }

  async function loadRecipes() {
    setIsLoadingRecipes(true)
    setRecipesLoadError(null)

    try {
      const response = await getRecipes(
        { status: recipesStatus, q: debouncedRecipesSearch || undefined, page: recipesPage, pageSize: RECIPES_PAGE_SIZE },
        token,
      )
      setRecipes(response.recipes)
      setRecipesTotal(response.pagination.total)
      setRecipesTotalPages(response.pagination.totalPages)
    } catch {
      setRecipesLoadError('No se pudieron cargar las recetas.')
      setRecipes([])
    } finally {
      setIsLoadingRecipes(false)
    }
  }

  async function loadOptions() {
    setOptionsLoadError(null)

    try {
      const [warehousesResponse, finishedResponse, rawResponse, activeRecipesResponse] = await Promise.all([
        getWarehouses('active', token),
        getProducts({ status: 'active', productType: 'finished_product', page: 1, pageSize: 100 }, token),
        getProducts({ status: 'active', productType: 'raw_material', page: 1, pageSize: 100 }, token),
        getRecipes({ status: 'active', page: 1, pageSize: 100 }, token),
      ])

      setWarehouses(warehousesResponse.warehouses)
      setFinishedProducts(finishedResponse.products)
      setRawMaterials(rawResponse.products)
      setActiveRecipes(activeRecipesResponse.recipes)
      setProductionWarehouseId((current) => current || warehousesResponse.warehouses[0]?.id || '')
      setProductionProductId((current) =>
        activeRecipesResponse.recipes.some((recipe) => recipe.productId === current)
          ? current
          : activeRecipesResponse.recipes[0]?.productId ?? '',
      )
    } catch {
      setOptionsLoadError('No se pudieron cargar productos, depósitos y recetas activas.')
    }
  }

  useEffect(() => {
    void loadRuns()
  }, [debouncedRunsSearch, runsPage, runsStatus, token])

  useEffect(() => {
    void loadRecipes()
  }, [debouncedRecipesSearch, recipesPage, recipesStatus, token])

  useEffect(() => {
    void loadOptions()
  }, [token])

  // Vista previa calculada por el backend (misma logica que el registro real).
  useEffect(() => {
    setProductionStockError(null)
    const quantity = Number(productionQuantity)
    if (!isProductionFormOpen || !productionProductId || !productionWarehouseId || !productionQuantity) {
      setPreviewState({ status: 'idle' })
      return
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setPreviewState({ status: 'error', message: 'La cantidad a producir debe ser mayor a 0.' })
      return
    }

    const requestId = ++previewRequestRef.current
    setPreviewState({ status: 'loading' })
    const timer = window.setTimeout(async () => {
      try {
        const response = await previewProductionRun(
          { productId: productionProductId, warehouseId: productionWarehouseId, quantity },
          token,
        )
        if (requestId === previewRequestRef.current) {
          setPreviewState({ status: 'ready', preview: response.preview })
        }
      } catch (error) {
        if (requestId === previewRequestRef.current) {
          setPreviewState({ status: 'error', message: errorMessageOf(error, 'No se pudo calcular la vista previa.') })
        }
      }
    }, 350)

    return () => window.clearTimeout(timer)
  }, [isProductionFormOpen, productionProductId, productionWarehouseId, productionQuantity, token])

  function openProductionForm(productId?: string) {
    setIsProductionFormOpen(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    setProductionStockError(null)
    if (productId) {
      setProductionProductId(productId)
    }
  }

  async function handleSelectRun(runId: string) {
    setIsLoadingRunDetail(true)
    setErrorMessage(null)
    setIsVoidConfirmOpen(false)
    setVoidReason('')

    try {
      const response = await getProductionRunById(runId, token)
      setSelectedRun(response.productionRun)
    } catch (error) {
      setErrorMessage(errorMessageOf(error, 'No se pudo cargar el detalle de la producción.'))
    } finally {
      setIsLoadingRunDetail(false)
    }
  }

  async function handleSubmitProduction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (previewState.status !== 'ready' || !previewState.preview.canProduce) {
      return
    }

    setIsSubmittingProduction(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    setProductionStockError(null)

    try {
      const response = await createProductionRun(
        {
          productId: productionProductId,
          warehouseId: productionWarehouseId,
          quantity: Number(productionQuantity),
          notes: emptyToNull(productionNotes),
        },
        token,
      )

      setSelectedRun(response.productionRun)
      setIsVoidConfirmOpen(false)
      setSuccessMessage(
        `${response.productionRun.runNumber} registrada: +${formatQuantity(response.productionRun.quantityProduced, response.productionRun.productUnit)} de ${response.productionRun.productName}. Costo actualizado a ${formatMoney(response.resultingCost)}.`,
      )
      setProductionQuantity('')
      setProductionNotes('')
      setIsProductionFormOpen(false)
      setRunsPage(1)
      await loadRuns()
    } catch (error) {
      const stockError = getInsufficientStockError(error)
      if (stockError) {
        setProductionStockError(stockError)
      } else {
        setErrorMessage(errorMessageOf(error, 'No se pudo registrar la producción.'))
      }
    } finally {
      setIsSubmittingProduction(false)
    }
  }

  async function handleVoidRun() {
    if (!selectedRun) {
      return
    }

    setIsVoiding(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const response = await voidProductionRun(selectedRun.id, emptyToNull(voidReason), token)
      setSelectedRun(response.productionRun)
      setIsVoidConfirmOpen(false)
      setVoidReason('')
      setSuccessMessage(`${response.productionRun.runNumber} anulada. Se devolvió la materia prima y se descontó el terminado.`)
      await loadRuns()
    } catch (error) {
      setErrorMessage(errorMessageOf(error, 'No se pudo anular la producción.'))
    } finally {
      setIsVoiding(false)
    }
  }

  function resetRecipeForm() {
    setRecipeProductId(finishedProducts.find((product) => !activeRecipes.some((recipe) => recipe.productId === product.id))?.id ?? finishedProducts[0]?.id ?? '')
    setRecipeYield('1')
    setRecipeNotes('')
    setRecipeItems([{ ingredientProductId: rawMaterials[0]?.id ?? '', quantity: '1' }])
  }

  function openCreateRecipe() {
    resetRecipeForm()
    setRecipeFormMode({ type: 'create' })
    setErrorMessage(null)
    setSuccessMessage(null)
  }

  async function loadRecipeDetail(recipeId: string) {
    setPendingRecipeId(recipeId)
    setErrorMessage(null)

    try {
      const response = await getRecipeById(recipeId, token)
      return response.recipe
    } catch (error) {
      setErrorMessage(errorMessageOf(error, 'No se pudo cargar la receta.'))
      return null
    } finally {
      setPendingRecipeId(null)
    }
  }

  async function handleViewRecipe(recipeId: string) {
    const recipe = await loadRecipeDetail(recipeId)
    if (recipe) {
      setSelectedRecipe(recipe)
    }
  }

  async function handleEditRecipe(recipeId: string) {
    const recipe = await loadRecipeDetail(recipeId)
    if (!recipe) {
      return
    }

    setSelectedRecipe(null)
    setRecipeFormMode({ type: 'edit', recipe })
    setRecipeProductId(recipe.productId)
    setRecipeYield(String(Number(recipe.yieldQuantity)))
    setRecipeNotes(recipe.notes ?? '')
    setRecipeItems(
      recipe.items.map((item) => ({ ingredientProductId: item.ingredientProductId, quantity: String(Number(item.quantity)) })),
    )
    setSuccessMessage(null)
  }

  async function handleToggleRecipeStatus(recipe: Recipe) {
    setPendingRecipeId(recipe.id)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      await updateRecipeStatus(recipe.id, !recipe.isActive, token)
      setSuccessMessage(
        recipe.isActive
          ? `Receta de ${recipe.productName} inactivada.`
          : `Receta de ${recipe.productName} activada.`,
      )
      if (selectedRecipe?.id === recipe.id) {
        setSelectedRecipe(null)
      }
      await Promise.all([loadRecipes(), loadOptions()])
    } catch (error) {
      setErrorMessage(errorMessageOf(error, 'No se pudo actualizar la receta.'))
    } finally {
      setPendingRecipeId(null)
    }
  }

  function updateRecipeItem(index: number, patch: Partial<RecipeFormItem>) {
    setRecipeItems((currentItems) =>
      currentItems.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    )
  }

  async function handleSubmitRecipe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const yieldQuantity = Number(recipeYield)
    const items = recipeItems.map((item) => ({
      ingredientProductId: item.ingredientProductId,
      quantity: Number(item.quantity),
    }))

    if (!recipeProductId || !Number.isFinite(yieldQuantity) || yieldQuantity <= 0) {
      setErrorMessage('Elegí el producto terminado e indicá un rendimiento mayor a 0.')
      return
    }

    if (items.some((item) => !item.ingredientProductId || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      setErrorMessage('Cada ingrediente debe tener materia prima y cantidad mayor a 0.')
      return
    }

    if (new Set(items.map((item) => item.ingredientProductId)).size !== items.length) {
      setErrorMessage('La receta no puede repetir ingredientes.')
      return
    }

    setIsSubmittingRecipe(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      const notes = emptyToNull(recipeNotes)
      const response =
        recipeFormMode.type === 'edit'
          ? await updateRecipe(recipeFormMode.recipe.id, { yieldQuantity, notes, items }, token)
          : await createRecipe({ productId: recipeProductId, yieldQuantity, notes, items }, token)

      setSuccessMessage(
        recipeFormMode.type === 'edit'
          ? `Receta de ${response.recipe.productName} actualizada.`
          : `Receta de ${response.recipe.productName} creada.`,
      )
      setRecipeFormMode({ type: 'closed' })
      setSelectedRecipe(response.recipe)
      await Promise.all([loadRecipes(), loadOptions()])
    } catch (error) {
      setErrorMessage(errorMessageOf(error, 'No se pudo guardar la receta.'))
    } finally {
      setIsSubmittingRecipe(false)
    }
  }

  const preview = previewState.status === 'ready' ? previewState.preview : null
  const selectedRecipeForProduction = activeRecipes.find((recipe) => recipe.productId === productionProductId)
  const productionUnit = selectedRecipeForProduction?.productUnit
  const recipeProductUnit = finishedProducts.find((product) => product.id === recipeProductId)?.unit
    ?? (recipeFormMode.type === 'edit' ? recipeFormMode.recipe.productUnit : undefined)

  let submitDisabledReason: string | null = null
  if (activeRecipes.length === 0) {
    submitDisabledReason = 'No hay recetas activas. Creá una receta para poder producir.'
  } else if (warehouses.length === 0) {
    submitDisabledReason = 'No hay depósitos activos.'
  } else if (!productionQuantity) {
    submitDisabledReason = 'Indicá la cantidad a producir.'
  } else if (previewState.status === 'loading') {
    submitDisabledReason = 'Calculando vista previa...'
  } else if (previewState.status === 'error') {
    submitDisabledReason = previewState.message
  } else if (preview && !preview.canProduce) {
    submitDisabledReason = `Falta materia prima: ${preview.shortages
      .map((shortage) => `${shortage.productName} (faltan ${formatQuantity(shortage.missing, shortage.unit)})`)
      .join(', ')}.`
  }

  return (
    <main className="page production-page" aria-busy={isLoadingRuns || isLoadingRecipes}>
      <div className="page-header">
        <div>
          <h1>Producción</h1>
          <p>Definí recetas y transformá materia prima en producto terminado con stock y costo trazados.</p>
        </div>
      </div>

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

      {optionsLoadError ? (
        <LoadErrorState message={optionsLoadError} onRetry={() => void loadOptions()} />
      ) : null}

      {canWriteProduction && isProductionFormOpen ? (
        <Panel className="production-panel" title="Registrar producción">
          <form className="production-form" onSubmit={handleSubmitProduction}>
            <label className="field">
              Producto terminado
              <select
                className="select-input"
                value={productionProductId}
                onChange={(event) => setProductionProductId(event.target.value)}
                required
              >
                {activeRecipes.length === 0 ? <option value="">Sin recetas activas</option> : null}
                {activeRecipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.productId}>
                    {recipe.productName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Depósito
              <select
                className="select-input"
                value={productionWarehouseId}
                onChange={(event) => setProductionWarehouseId(event.target.value)}
                required
              >
                {warehouses.length === 0 ? <option value="">Sin depósitos activos</option> : null}
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Cantidad a producir{productionUnit ? ` (${unitShortLabel[productionUnit]})` : ''}
              <input
                type="number"
                min="0.001"
                step="0.001"
                inputMode="decimal"
                value={productionQuantity}
                onChange={(event) => setProductionQuantity(event.target.value)}
                placeholder={
                  selectedRecipeForProduction
                    ? `La receta rinde ${formatQuantity(selectedRecipeForProduction.yieldQuantity, selectedRecipeForProduction.productUnit)}`
                    : undefined
                }
                required
              />
            </label>
            <label className="field production-form__wide">
              Notas
              <input
                value={productionNotes}
                maxLength={600}
                onChange={(event) => setProductionNotes(event.target.value)}
                placeholder="Opcional"
              />
            </label>

            <section className="production-preview production-form__wide" aria-live="polite" aria-label="Vista previa">
              <div className="production-preview__header">
                <strong>Vista previa</strong>
                {preview ? (
                  <span>
                    Receta: rinde {formatQuantity(preview.recipeYieldQuantity, preview.productUnit)} · {preview.warehouseName}
                  </span>
                ) : null}
              </div>
              {previewState.status === 'idle' ? (
                <p className="production-preview__hint">Elegí producto, depósito y cantidad para ver el consumo.</p>
              ) : null}
              {previewState.status === 'loading' ? <p className="production-preview__hint">Calculando...</p> : null}
              {previewState.status === 'error' ? (
                <p className="production-preview__hint production-preview__hint--error">{previewState.message}</p>
              ) : null}
              {preview ? (
                <>
                  <TableScroll>
                    <table className="products-table">
                      <thead>
                        <tr>
                          <th>Ingrediente</th>
                          <th className="numeric-cell">Necesario</th>
                          <th className="numeric-cell">Disponible</th>
                          <th>Estado</th>
                          <th className="numeric-cell">Costo unit.</th>
                          <th className="numeric-cell">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.ingredients.map((ingredient) => (
                          <tr key={ingredient.productId}>
                            <td>{ingredient.productName}</td>
                            <td className="numeric-cell">{formatQuantity(ingredient.required, ingredient.unit)}</td>
                            <td className="numeric-cell">{formatQuantity(ingredient.available, ingredient.unit)}</td>
                            <td>
                              {ingredient.isSufficient ? (
                                <StatusBadge>Alcanza</StatusBadge>
                              ) : (
                                <StatusBadge tone="danger">Faltan {formatQuantity(ingredient.missing, ingredient.unit)}</StatusBadge>
                              )}
                            </td>
                            <td className="numeric-cell">{formatMoney(ingredient.unitCost)}</td>
                            <td className="numeric-cell">{formatMoney(ingredient.subtotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                  <dl className="production-preview__summary">
                    <div>
                      <dt>Costo total</dt>
                      <dd>{formatMoney(preview.totalCost)}</dd>
                    </div>
                    <div>
                      <dt>Costo por {unitShortLabel[preview.productUnit]}</dt>
                      <dd>{formatMoney(preview.unitCost)}</dd>
                    </div>
                    <div>
                      <dt>Costo promedio del terminado</dt>
                      <dd>
                        {formatMoney(preview.currentCost)} → <strong>{formatMoney(preview.resultingCost)}</strong>
                      </dd>
                    </div>
                  </dl>
                </>
              ) : null}
            </section>

            {productionStockError ? (
              <div className="production-form__wide">
                <StockShortageNotice error={productionStockError} />
              </div>
            ) : null}

            <div className="products-form__actions production-form__wide">
              <Button
                type="submit"
                disabled={isSubmittingProduction || submitDisabledReason !== null}
                aria-describedby={submitDisabledReason ? 'production-submit-reason' : undefined}
              >
                {isSubmittingProduction ? 'Registrando...' : 'Confirmar producción'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setIsProductionFormOpen(false)}>
                Cerrar
              </Button>
              {submitDisabledReason ? (
                <span id="production-submit-reason" className="production-form__reason">
                  {submitDisabledReason}
                </span>
              ) : null}
            </div>
          </form>
        </Panel>
      ) : null}

      <Panel
        className="production-panel"
        title="Producciones"
        action={
          canWriteProduction ? (
            isProductionFormOpen ? undefined : (
              <Button type="button" variant="secondary" onClick={() => openProductionForm()}>
                Nueva producción
              </Button>
            )
          ) : (
            <span>Solo lectura</span>
          )
        }
      >
        <div className="products-toolbar">
          <label className="field products-toolbar__field">
            Buscar por número o producto
            <input
              type="search"
              value={runsSearch}
              onChange={(event) => setRunsSearch(event.target.value)}
              placeholder="Ej: PROD-000001"
            />
          </label>
          <label className="field products-toolbar__field products-toolbar__field--compact">
            Estado
            <select
              className="select-input"
              value={runsStatus}
              onChange={(event) => {
                setRunsStatus(event.target.value as ProductionRunStatus | 'all')
                setRunsPage(1)
              }}
            >
              <option value="all">Todas</option>
              <option value="completed">Completadas</option>
              <option value="voided">Anuladas</option>
            </select>
          </label>
        </div>

        {runsLoadError ? (
          <LoadErrorState message={runsLoadError} onRetry={() => void loadRuns()} isRetrying={isLoadingRuns} />
        ) : null}
        {isLoadingRuns ? <p>Cargando producciones...</p> : null}
        {!isLoadingRuns && !runsLoadError && runs.length === 0 ? (
          <p>
            {debouncedRunsSearch || runsStatus !== 'all'
              ? 'No hay producciones para los filtros seleccionados.'
              : 'Todavía no se registraron producciones.'}
          </p>
        ) : null}

        {!isLoadingRuns && runs.length > 0 ? (
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th className="numeric-cell">Cantidad</th>
                  <th>Depósito</th>
                  <th className="numeric-cell">Costo unit.</th>
                  <th className="numeric-cell">Total</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.runNumber}</td>
                    <td>{new Date(run.createdAt).toLocaleString('es-PY')}</td>
                    <td>{run.productName}</td>
                    <td className="numeric-cell">{formatQuantity(run.quantityProduced, run.productUnit)}</td>
                    <td>{run.warehouseName}</td>
                    <td className="numeric-cell">{formatMoney(run.unitCost)}</td>
                    <td className="numeric-cell">{formatMoney(run.totalCost)}</td>
                    <td>
                      <StatusBadge tone={runStatusDisplay[run.status].tone}>{runStatusDisplay[run.status].label}</StatusBadge>
                    </td>
                    <td className="products-table__actions">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={isLoadingRunDetail}
                        onClick={() => void handleSelectRun(run.id)}
                      >
                        Ver detalle
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : null}

        {runsLoadError ? null : (
          <div className="products-pagination">
            <span>
              Página {runsPage} de {Math.max(runsTotalPages, 1)} · Total: {runsTotal}
            </span>
            <div className="products-pagination__actions">
              <Button
                type="button"
                variant="secondary"
                disabled={runsPage <= 1}
                onClick={() => setRunsPage((current) => current - 1)}
              >
                Anterior
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={runsTotalPages === 0 || runsPage >= runsTotalPages}
                onClick={() => setRunsPage((current) => current + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {selectedRun ? (
        <Panel
          className="production-panel"
          title={`Producción ${selectedRun.runNumber}`}
          action={
            <Button type="button" variant="secondary" onClick={() => setSelectedRun(null)}>
              Cerrar
            </Button>
          }
        >
          <div className="purchase-detail-grid">
            <span>
              Producto: <strong>{selectedRun.productName}</strong>
            </span>
            <span>
              Cantidad: <strong>{formatQuantity(selectedRun.quantityProduced, selectedRun.productUnit)}</strong>
            </span>
            <span>
              Depósito: <strong>{selectedRun.warehouseName}</strong>
            </span>
            <span>
              Receta: <strong>rinde {formatQuantity(selectedRun.recipeYieldQuantity, selectedRun.productUnit)}</strong>
            </span>
            <span>
              Costo unitario: <strong>{formatMoney(selectedRun.unitCost)}</strong>
            </span>
            <span>
              Costo total: <strong>{formatMoney(selectedRun.totalCost)}</strong>
            </span>
            <span>
              Registró: <strong>{selectedRun.createdByUserName}</strong> el{' '}
              {new Date(selectedRun.createdAt).toLocaleString('es-PY')}
            </span>
            <StatusBadge tone={runStatusDisplay[selectedRun.status].tone}>
              {runStatusDisplay[selectedRun.status].label}
            </StatusBadge>
          </div>
          <p className="production-detail__caption">Materia prima consumida (costos al momento de producir)</p>
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th className="numeric-cell">Cantidad</th>
                  <th className="numeric-cell">Costo unitario</th>
                  <th className="numeric-cell">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {selectedRun.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.productName}</td>
                    <td className="numeric-cell">{formatQuantity(item.quantity, item.unit)}</td>
                    <td className="numeric-cell">{formatMoney(item.unitCost)}</td>
                    <td className="numeric-cell">{formatMoney(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {selectedRun.notes ? <p className="purchase-detail-notes">Notas: {selectedRun.notes}</p> : null}
          {selectedRun.status === 'voided' ? (
            <p className="purchase-detail-notes">
              Anulada por {selectedRun.voidedByUserName} el{' '}
              {selectedRun.voidedAt ? new Date(selectedRun.voidedAt).toLocaleString('es-PY') : ''}
              {selectedRun.voidReason ? ` · Motivo: ${selectedRun.voidReason}` : ''}
            </p>
          ) : null}

          {canWriteProduction && selectedRun.status === 'completed' ? (
            isVoidConfirmOpen ? (
              <div className="production-void" role="group" aria-label="Confirmar anulación">
                <p>
                  Se descontarán {formatQuantity(selectedRun.quantityProduced, selectedRun.productUnit)} de{' '}
                  {selectedRun.productName} y se devolverá la materia prima a {selectedRun.warehouseName}. Solo es
                  posible si ese terminado sigue disponible (sin reservar ni vender).
                </p>
                <label className="field">
                  Motivo
                  <input
                    value={voidReason}
                    maxLength={300}
                    onChange={(event) => setVoidReason(event.target.value)}
                    placeholder="Opcional"
                  />
                </label>
                <div className="products-form__actions">
                  <Button type="button" disabled={isVoiding} onClick={() => void handleVoidRun()}>
                    {isVoiding ? 'Anulando...' : 'Confirmar anulación'}
                  </Button>
                  <Button type="button" variant="secondary" disabled={isVoiding} onClick={() => setIsVoidConfirmOpen(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="order-actions">
                <Button type="button" variant="secondary" onClick={() => setIsVoidConfirmOpen(true)}>
                  Anular producción
                </Button>
              </div>
            )
          ) : null}
        </Panel>
      ) : null}

      <Panel
        className="production-panel"
        title="Recetas"
        action={
          canWriteProduction ? (
            <Button type="button" variant="secondary" onClick={openCreateRecipe}>
              Nueva receta
            </Button>
          ) : (
            <span>Solo lectura</span>
          )
        }
      >
        {canWriteProduction && recipeFormMode.type !== 'closed' ? (
          <form className="production-form recipe-form" onSubmit={handleSubmitRecipe}>
            <label className="field">
              Producto terminado
              <select
                className="select-input"
                value={recipeProductId}
                onChange={(event) => setRecipeProductId(event.target.value)}
                disabled={recipeFormMode.type === 'edit'}
                required
              >
                {recipeFormMode.type === 'edit' ? (
                  <option value={recipeFormMode.recipe.productId}>{recipeFormMode.recipe.productName}</option>
                ) : null}
                {recipeFormMode.type === 'create' && finishedProducts.length === 0 ? (
                  <option value="">Sin productos terminados activos</option>
                ) : null}
                {recipeFormMode.type === 'create'
                  ? finishedProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                        {activeRecipes.some((recipe) => recipe.productId === product.id) ? ' (ya tiene receta activa)' : ''}
                      </option>
                    ))
                  : null}
              </select>
            </label>
            <label className="field">
              Rendimiento{recipeProductUnit ? ` (${unitShortLabel[recipeProductUnit]})` : ''}
              <input
                type="number"
                min="0.001"
                step="0.001"
                inputMode="decimal"
                value={recipeYield}
                onChange={(event) => setRecipeYield(event.target.value)}
                required
              />
            </label>
            <label className="field">
              Notas
              <input
                value={recipeNotes}
                maxLength={600}
                onChange={(event) => setRecipeNotes(event.target.value)}
                placeholder="Opcional"
              />
            </label>

            <div className="purchase-form__items production-form__wide">
              <div className="purchase-form__items-header">
                <strong>Ingredientes (para el rendimiento indicado)</strong>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={rawMaterials.length === 0}
                  onClick={() =>
                    setRecipeItems((current) => [
                      ...current,
                      {
                        ingredientProductId:
                          rawMaterials.find((product) => !current.some((item) => item.ingredientProductId === product.id))?.id ?? '',
                        quantity: '1',
                      },
                    ])
                  }
                >
                  Agregar ingrediente
                </Button>
              </div>
              {rawMaterials.length === 0 ? <p>No hay materias primas activas.</p> : null}
              {recipeItems.map((item, index) => {
                const ingredient = rawMaterials.find((product) => product.id === item.ingredientProductId)
                const isDuplicate =
                  item.ingredientProductId !== '' &&
                  recipeItems.findIndex((candidate) => candidate.ingredientProductId === item.ingredientProductId) !== index

                return (
                  <div className="recipe-item-row" key={index}>
                    <label className="field">
                      Materia prima
                      <select
                        className="select-input"
                        value={item.ingredientProductId}
                        onChange={(event) => updateRecipeItem(index, { ingredientProductId: event.target.value })}
                        aria-invalid={isDuplicate}
                        required
                      >
                        {item.ingredientProductId === '' ? <option value="">Elegí una materia prima</option> : null}
                        {rawMaterials.map((rawMaterial) => (
                          <option key={rawMaterial.id} value={rawMaterial.id}>
                            {rawMaterial.name}
                          </option>
                        ))}
                      </select>
                      {isDuplicate ? <small className="field-error">Ingrediente repetido</small> : null}
                    </label>
                    <label className="field">
                      Cantidad{ingredient ? ` (${unitShortLabel[ingredient.unit]})` : ''}
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        inputMode="decimal"
                        value={item.quantity}
                        onChange={(event) => updateRecipeItem(index, { quantity: event.target.value })}
                        required
                      />
                    </label>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={recipeItems.length === 1}
                      onClick={() => setRecipeItems((current) => current.filter((_item, itemIndex) => itemIndex !== index))}
                    >
                      Quitar
                    </Button>
                  </div>
                )
              })}
            </div>

            <div className="products-form__actions production-form__wide">
              <Button type="submit" disabled={isSubmittingRecipe || rawMaterials.length === 0 || !recipeProductId}>
                {isSubmittingRecipe ? 'Guardando...' : recipeFormMode.type === 'edit' ? 'Guardar cambios' : 'Crear receta'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setRecipeFormMode({ type: 'closed' })}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : null}

        <div className="products-toolbar">
          <label className="field products-toolbar__field">
            Buscar por producto
            <input
              type="search"
              value={recipesSearch}
              onChange={(event) => setRecipesSearch(event.target.value)}
              placeholder="Ej: Papa pelada"
            />
          </label>
          <label className="field products-toolbar__field products-toolbar__field--compact">
            Estado
            <select
              className="select-input"
              value={recipesStatus}
              onChange={(event) => {
                setRecipesStatus(event.target.value as RecipesStatusFilter)
                setRecipesPage(1)
              }}
            >
              <option value="all">Todas</option>
              <option value="active">Activas</option>
              <option value="inactive">Inactivas</option>
            </select>
          </label>
        </div>

        {recipesLoadError ? (
          <LoadErrorState message={recipesLoadError} onRetry={() => void loadRecipes()} isRetrying={isLoadingRecipes} />
        ) : null}
        {isLoadingRecipes ? <p>Cargando recetas...</p> : null}
        {!isLoadingRecipes && !recipesLoadError && recipes.length === 0 ? (
          <p>
            {debouncedRecipesSearch || recipesStatus !== 'all'
              ? 'No hay recetas para los filtros seleccionados.'
              : 'Todavía no hay recetas. Una receta indica cuánta materia prima consume un producto terminado.'}
          </p>
        ) : null}

        {!isLoadingRecipes && recipes.length > 0 ? (
          <TableScroll>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Producto terminado</th>
                  <th className="numeric-cell">Rinde</th>
                  <th className="numeric-cell">Ingredientes</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {recipes.map((recipe) => (
                  <tr key={recipe.id}>
                    <td>{recipe.productName}</td>
                    <td className="numeric-cell">{formatQuantity(recipe.yieldQuantity, recipe.productUnit)}</td>
                    <td className="numeric-cell">{recipe.itemCount}</td>
                    <td>
                      <StatusBadge tone={recipe.isActive ? 'success' : 'warning'}>
                        {recipe.isActive ? 'Activa' : 'Inactiva'}
                      </StatusBadge>
                    </td>
                    <td className="products-table__actions">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pendingRecipeId === recipe.id}
                        onClick={() => void handleViewRecipe(recipe.id)}
                      >
                        Ver
                      </Button>
                      {canWriteProduction ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={pendingRecipeId === recipe.id}
                            onClick={() => void handleEditRecipe(recipe.id)}
                          >
                            Editar
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={pendingRecipeId === recipe.id}
                            onClick={() => void handleToggleRecipeStatus(recipe)}
                          >
                            {recipe.isActive ? 'Inactivar' : 'Activar'}
                          </Button>
                          {recipe.isActive ? (
                            <Button type="button" variant="secondary" onClick={() => openProductionForm(recipe.productId)}>
                              Producir
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : null}

        {recipesLoadError ? null : (
          <div className="products-pagination">
            <span>
              Página {recipesPage} de {Math.max(recipesTotalPages, 1)} · Total: {recipesTotal}
            </span>
            <div className="products-pagination__actions">
              <Button
                type="button"
                variant="secondary"
                disabled={recipesPage <= 1}
                onClick={() => setRecipesPage((current) => current - 1)}
              >
                Anterior
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={recipesTotalPages === 0 || recipesPage >= recipesTotalPages}
                onClick={() => setRecipesPage((current) => current + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}

        {selectedRecipe ? (
          <div className="recipe-detail">
            <div className="purchase-form__items-header">
              <strong>
                Receta de {selectedRecipe.productName}: rinde {formatQuantity(selectedRecipe.yieldQuantity, selectedRecipe.productUnit)}
              </strong>
              <Button type="button" variant="secondary" onClick={() => setSelectedRecipe(null)}>
                Cerrar
              </Button>
            </div>
            <TableScroll>
              <table className="products-table">
                <thead>
                  <tr>
                    <th>Ingrediente</th>
                    <th className="numeric-cell">Cantidad</th>
                    <th className="numeric-cell">Costo vigente</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRecipe.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.productName}
                        {!item.isActive || item.productType !== 'raw_material' ? (
                          <>
                            {' '}
                            <StatusBadge tone="danger">No disponible</StatusBadge>
                          </>
                        ) : null}
                      </td>
                      <td className="numeric-cell">{formatQuantity(item.quantity, item.unit)}</td>
                      <td className="numeric-cell">{formatMoney(item.unitCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className="purchase-detail-notes">
              El costo de cada producción se calcula al registrarla, con la vista previa. · Última edición:{' '}
              {selectedRecipe.updatedByUserName}
              {selectedRecipe.notes ? ` · ${selectedRecipe.notes}` : ''}
            </p>
          </div>
        ) : null}
      </Panel>

    </main>
  )
}
