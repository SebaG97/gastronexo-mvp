// Mision 8.7: procesamiento de fotos de productos.
//
// Cualquier foto (JPG, PNG, WebP; de celular o camara) se decodifica, se endereza segun EXIF, se
// achica a 1000 px de lado mayor y se guarda como WebP. El resultado no conserva metadatos (ni
// GPS ni datos de la camara) y pesa decenas de KB en lugar de megas.

import sharp from 'sharp'
import { pool } from '../db/pool.js'
import { isValidMediaKey, keyBelongsTo, LOCAL_MEDIA_PREFIX, mediaStorage } from './storage.js'

export const PRODUCT_IMAGE_MAX_SIDE = 1000
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'avif'])

export class ImageRejected extends Error {
  constructor(message: string) {
    super(message)
  }
}

async function assertSupportedImage(input: Buffer) {
  let format: string | undefined
  try {
    // limitInputPixels: una imagen de 20000x20000 (o una "bomba" comprimida) no se decodifica.
    const metadata = await sharp(input, { limitInputPixels: 60_000_000 }).metadata()
    format = metadata.format
  } catch {
    throw new ImageRejected('El archivo no es una imagen válida. Usá una foto JPG, PNG o WebP.')
  }

  if (!format || !ACCEPTED_FORMATS.has(format)) {
    throw new ImageRejected(
      format === 'heif'
        ? 'Las fotos HEIC del iPhone no se pueden usar todavía. Exportala como JPG y subila de nuevo.'
        : 'Formato de imagen no soportado. Usá una foto JPG, PNG o WebP.',
    )
  }
}

async function render(pipeline: () => Promise<Buffer>) {
  try {
    return await pipeline()
  } catch {
    throw new ImageRejected('No se pudo leer la imagen (puede estar dañada). Probá con otra foto.')
  }
}

const decode = (input: Buffer) => sharp(input, { limitInputPixels: 60_000_000, failOn: 'error' })

export async function processProductImage(input: Buffer) {
  await assertSupportedImage(input)
  return render(() =>
    decode(input)
      .rotate()
      .resize({ width: PRODUCT_IMAGE_MAX_SIDE, height: PRODUCT_IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 80 })
      .toBuffer(),
  )
}

/**
 * Logo de la tienda (mision 8.8): conserva la transparencia y recorta el margen vacio, para que
 * en la cabecera se vea el dibujo y no un cuadrado con aire alrededor.
 */
export async function processLogoImage(input: Buffer) {
  await assertSupportedImage(input)
  return render(async () => {
    const trimmed = await decode(input)
      .rotate()
      .trim({ threshold: 10 })
      .toBuffer()
      .catch(() => decode(input).rotate().toBuffer()) // imagen sin margen que recortar
    return sharp(trimmed)
      .resize({ width: 800, height: 400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90, alphaQuality: 100 })
      .toBuffer()
  })
}

/** Foto de portada de la tienda: como la de producto, pero mas ancha. */
export async function processCoverImage(input: Buffer) {
  await assertSupportedImage(input)
  return render(() =>
    decode(input)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 80 })
      .toBuffer(),
  )
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** URL aceptable como imagen de producto: link http(s) o una foto subida a la propia API. */
export function isAcceptableImageUrl(value: string) {
  if (value.startsWith(LOCAL_MEDIA_PREFIX)) return isValidMediaKey(value.slice(LOCAL_MEDIA_PREFIX.length))
  return isHttpUrl(value)
}

/** Una foto subida solo puede usarse en productos de la misma organizacion. */
export function imageUrlBelongsTo(url: string | null | undefined, organizationId: string) {
  if (!url) return true
  const key = url.startsWith(LOCAL_MEDIA_PREFIX) ? url.slice(LOCAL_MEDIA_PREFIX.length) : mediaStorage.keyFromUrl(url)
  if (!key || !isValidMediaKey(key)) return true // link externo
  return keyBelongsTo(key, organizationId)
}

/**
 * Borra una foto subida que ya no usa ningun producto. Los links externos y las fotos de otra
 * organizacion no se tocan. Se llama despues del commit: si falla, queda un archivo huerfano,
 * nunca un producto sin su foto.
 */
export async function removeImageIfUnused(url: string | null | undefined, organizationId: string) {
  if (!url) return
  const key = mediaStorage.keyFromUrl(url)
  if (!key || !keyBelongsTo(key, organizationId)) return
  const stillUsed = await pool.query(
    `SELECT 1 FROM products WHERE image_url = $1
     UNION ALL
     SELECT 1 FROM storefront_settings WHERE logo_url = $1 OR cover_url = $1
     LIMIT 1`,
    [url],
  )
  if (stillUsed.rowCount) return
  await mediaStorage.remove(key)
}
