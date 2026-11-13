// Mision 8.7: las fotos subidas en desarrollo se guardan como ruta relativa de la API
// (/api/uploads/...). En produccion la API comparte origen con la web; en desarrollo hay que
// anteponer la URL de la API. Los links externos (https://...) quedan como estan.

const apiBaseUrl = import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3000')

export function resolveMediaUrl(url: string | null | undefined) {
  if (!url) return null
  return url.startsWith('/api/') ? `${apiBaseUrl}${url}` : url
}

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_IMAGE_UPLOAD_MB = 15

/** Mensaje de error para un archivo elegido, o null si se puede subir. */
export function imageFileProblem(file: File) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
      ? 'Las fotos HEIC del iPhone no se pueden usar todavía. Exportala como JPG.'
      : 'Elegí una foto JPG, PNG o WebP.'
  }
  if (file.size > MAX_IMAGE_UPLOAD_MB * 1024 * 1024) {
    return `La foto pesa más de ${MAX_IMAGE_UPLOAD_MB} MB. Elegí una más liviana.`
  }
  return null
}
