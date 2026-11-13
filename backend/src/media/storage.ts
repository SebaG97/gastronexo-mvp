// Mision 8.7: almacenamiento de imagenes subidas (fotos de productos).
//
// Dos destinos con la misma interfaz:
// - local: archivos en UPLOADS_DIR, servidos por la propia API en /api/uploads/<key>. Sirve para
//   desarrollo. En App Platform el disco del contenedor se borra en cada deploy, asi que en
//   produccion se usa s3.
// - s3: cualquier almacenamiento compatible con S3 (DigitalOcean Spaces, MinIO para pruebas). La
//   URL publica sale de S3_PUBLIC_BASE_URL (por ejemplo el CDN del Space).
//
// Las claves tienen la forma products/<organizationId>/<uuid>.webp. Se generan en el servidor y
// se validan antes de leer o borrar, asi que nunca llega una ruta armada por el cliente.

import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'

export const LOCAL_MEDIA_PREFIX = '/api/uploads/'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const KEY_PATTERN = new RegExp(`^products/(${UUID})/${UUID}\\.webp$`)

export function isValidMediaKey(key: string) {
  return KEY_PATTERN.test(key)
}

export function productImageKey(organizationId: string, fileId: string) {
  return `products/${organizationId}/${fileId}.webp`
}

export interface MediaStorage {
  readonly driver: 'local' | 's3'
  put(key: string, body: Buffer, contentType: string): Promise<string>
  remove(key: string): Promise<void>
  /** Clave propia a partir de una URL guardada, o null si la URL no es de este almacenamiento. */
  keyFromUrl(url: string): string | null
}

class LocalMediaStorage implements MediaStorage {
  readonly driver = 'local' as const
  constructor(private readonly root: string) {}

  private filePath(key: string) {
    if (!isValidMediaKey(key)) throw new Error('Clave de archivo inválida.')
    return path.join(this.root, ...key.split('/'))
  }

  async put(key: string, body: Buffer) {
    const target = this.filePath(key)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, body)
    return LOCAL_MEDIA_PREFIX + key
  }

  async remove(key: string) {
    await rm(this.filePath(key), { force: true })
  }

  async read(key: string) {
    return readFile(this.filePath(key))
  }

  keyFromUrl(url: string) {
    if (!url.startsWith(LOCAL_MEDIA_PREFIX)) return null
    const key = url.slice(LOCAL_MEDIA_PREFIX.length)
    return isValidMediaKey(key) ? key : null
  }
}

class S3MediaStorage implements MediaStorage {
  readonly driver = 's3' as const
  private readonly client: S3Client
  private readonly publicBase: string

  constructor(
    private readonly bucket: string,
    options: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean; publicBaseUrl: string },
  ) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    })
    this.publicBase = options.publicBaseUrl.replace(/\/+$/, '') + '/'
  }

  async put(key: string, body: Buffer, contentType: string) {
    if (!isValidMediaKey(key)) throw new Error('Clave de archivo inválida.')
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ACL: 'public-read',
        // El nombre de cada archivo es unico (uuid): se puede cachear para siempre.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    )
    return this.publicBase + key
  }

  async remove(key: string) {
    if (!isValidMediaKey(key)) throw new Error('Clave de archivo inválida.')
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  keyFromUrl(url: string) {
    if (!url.startsWith(this.publicBase)) return null
    const key = url.slice(this.publicBase.length)
    return isValidMediaKey(key) ? key : null
  }
}

function createStorage(): MediaStorage {
  if (config.MEDIA_STORAGE === 's3') {
    return new S3MediaStorage(config.S3_BUCKET!, {
      endpoint: config.S3_ENDPOINT!,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY_ID!,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      publicBaseUrl: config.S3_PUBLIC_BASE_URL!,
    })
  }
  return new LocalMediaStorage(path.resolve(config.UPLOADS_DIR))
}

export const mediaStorage = createStorage()

export function localMediaStorage() {
  return mediaStorage instanceof LocalMediaStorage ? mediaStorage : null
}

/** La clave pertenece a la organizacion (products/<organizationId>/...). */
export function keyBelongsTo(key: string, organizationId: string) {
  return KEY_PATTERN.exec(key)?.[1] === organizationId
}
