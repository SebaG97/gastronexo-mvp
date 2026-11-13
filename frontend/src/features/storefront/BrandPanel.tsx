// Mision 8.8: marca de la tienda. Logo, foto de portada y color de la cabecera.
// Las imagenes se suben apenas se eligen (no dependen del boton Guardar de la configuracion).

import { useRef, useState } from 'react'
import { Button, Panel } from '../../shared/components'
import {
  ApiError,
  deleteStoreImage,
  updateStoreBrandColor,
  uploadStoreImage,
  type StoreImageSlot,
  type StorefrontSettings,
} from '../../shared/lib/auth-api'
import { BRAND_COLOR_PRESETS, DEFAULT_BRAND_COLOR, isReadableBrandColor } from '../../shared/lib/brand'
import { ACCEPTED_IMAGE_TYPES, imageFileProblem, resolveMediaUrl } from '../../shared/lib/media'

type BrandPanelProps = {
  token: string
  canManage: boolean
  settings: StorefrontSettings
  onChange: (settings: StorefrontSettings) => void
}

const slotCopy: Record<StoreImageSlot, { title: string; hint: string; uploaded: string; removed: string }> = {
  logo: {
    title: 'Logo',
    hint: 'Va sobre la cabecera de color: usá la versión clara (blanca) del logo, PNG con fondo transparente.',
    uploaded: 'Logo actualizado.',
    removed: 'Logo quitado: la tienda muestra el nombre.',
  },
  cover: {
    title: 'Foto de portada',
    hint: 'Una foto horizontal que muestre tus productos. Aparece arriba del catálogo.',
    uploaded: 'Portada actualizada.',
    removed: 'Portada quitada.',
  },
}

export function BrandPanel({ token, canManage, settings, onChange }: BrandPanelProps) {
  const [busy, setBusy] = useState<StoreImageSlot | 'color' | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [customColor, setCustomColor] = useState(settings.brandColor ?? DEFAULT_BRAND_COLOR)
  const inputs = { logo: useRef<HTMLInputElement>(null), cover: useRef<HTMLInputElement>(null) }

  const currentColor = settings.brandColor ?? DEFAULT_BRAND_COLOR
  const storeName = settings.displayName || settings.organizationName

  async function handleFile(slot: StoreImageSlot, file: File | undefined) {
    if (!file) return
    const problem = imageFileProblem(file)
    if (problem) {
      setMessage({ tone: 'error', text: problem })
      return
    }
    setBusy(slot)
    setMessage(null)
    try {
      const response = await uploadStoreImage(slot, file, token)
      onChange(response.settings)
      setMessage({ tone: 'success', text: slotCopy[slot].uploaded })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof ApiError ? error.message : 'No se pudo subir la imagen.' })
    } finally {
      setBusy(null)
    }
  }

  async function handleRemove(slot: StoreImageSlot) {
    setBusy(slot)
    setMessage(null)
    try {
      const response = await deleteStoreImage(slot, token)
      onChange(response.settings)
      setMessage({ tone: 'success', text: slotCopy[slot].removed })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof ApiError ? error.message : 'No se pudo quitar la imagen.' })
    } finally {
      setBusy(null)
    }
  }

  async function saveColor(color: string | null) {
    if (color && !isReadableBrandColor(color)) {
      setMessage({ tone: 'error', text: 'Ese color es muy claro: el texto blanco de la cabecera no se leería. Elegí uno más oscuro.' })
      return
    }
    setBusy('color')
    setMessage(null)
    try {
      const response = await updateStoreBrandColor(color, token)
      onChange(response.settings)
      setCustomColor(response.settings.brandColor ?? DEFAULT_BRAND_COLOR)
      setMessage({ tone: 'success', text: 'Color guardado.' })
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof ApiError ? error.message : 'No se pudo guardar el color.' })
    } finally {
      setBusy(null)
    }
  }

  const logoSrc = resolveMediaUrl(settings.logoUrl)
  const coverSrc = resolveMediaUrl(settings.coverUrl)
  const disabled = !canManage || busy !== null

  return (
    <Panel title="Marca">
      <div className="brand-panel">
        <div className="brand-preview" style={{ backgroundColor: currentColor }} aria-label="Vista previa de la cabecera de la tienda">
          {logoSrc ? <img className="brand-preview__logo" src={logoSrc} alt={storeName} /> : <span className="brand-preview__name">{storeName}</span>}
          {coverSrc ? <img className="brand-preview__cover" src={coverSrc} alt="" /> : null}
        </div>

        {(['logo', 'cover'] as StoreImageSlot[]).map((slot) => {
          const hasImage = slot === 'logo' ? Boolean(settings.logoUrl) : Boolean(settings.coverUrl)
          return (
            <div key={slot} className="brand-panel__row">
              <div>
                <strong>{slotCopy[slot].title}</strong>
                <p className="brand-panel__hint">{slotCopy[slot].hint}</p>
              </div>
              <div className="brand-panel__actions">
                <Button type="button" variant="secondary" disabled={disabled} onClick={() => inputs[slot].current?.click()}>
                  {busy === slot ? 'Subiendo...' : hasImage ? 'Cambiar' : 'Subir'}
                </Button>
                {hasImage ? (
                  <Button type="button" variant="secondary" disabled={disabled} onClick={() => void handleRemove(slot)}>
                    Quitar
                  </Button>
                ) : null}
                <input
                  ref={inputs[slot]}
                  className="products-form__file-input"
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(',')}
                  tabIndex={-1}
                  aria-label={`Elegir ${slotCopy[slot].title.toLowerCase()}`}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    void handleFile(slot, file)
                  }}
                />
              </div>
            </div>
          )
        })}

        <div className="brand-panel__row brand-panel__row--color">
          <div>
            <strong>Color de la cabecera</strong>
            <p className="brand-panel__hint">Tiene que ser oscuro para que el texto blanco se lea.</p>
          </div>
          <div className="brand-panel__colors" role="radiogroup" aria-label="Color de la cabecera">
            {BRAND_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                role="radio"
                aria-checked={currentColor === preset.value}
                className="brand-swatch"
                disabled={disabled}
                onClick={() => void saveColor(preset.value === DEFAULT_BRAND_COLOR ? null : preset.value)}
              >
                <span className="brand-swatch__color" style={{ backgroundColor: preset.value }} aria-hidden="true" />
                {preset.label}
              </button>
            ))}
            <label className="brand-swatch brand-swatch--custom">
              <input
                type="color"
                value={customColor}
                disabled={disabled}
                onChange={(event) => setCustomColor(event.target.value)}
                aria-label="Otro color"
              />
              Otro
            </label>
            {customColor !== currentColor ? (
              <Button type="button" disabled={disabled} onClick={() => void saveColor(customColor)}>
                Usar este color
              </Button>
            ) : null}
          </div>
        </div>

        {message ? (
          <p className={`members-message members-message--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
