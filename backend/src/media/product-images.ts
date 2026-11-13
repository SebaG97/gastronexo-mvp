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

export async function processProductImage(input: Buffer) {
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

  try {
    return await sharp(input, { limitInputPixels: 60_000_000, failOn: 'error' })
      .rotate()
      .resize({ width: PRODUCT_IMAGE_MAX_SIDE, height: PRODUCT_IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 80 })
      .toBuffer()
  } catch {
    throw new ImageRejected('No se pudo leer la imagen (puede estar dañada). Probá con otra foto.')
  }
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
  const stillUsed = await pool.query('SELECT 1 FROM products WHERE image_url = $1 LIMIT 1', [url])
  if (stillUsed.rowCount) return
  await mediaStorage.remove(key)
}
