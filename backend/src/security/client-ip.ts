import type { FastifyRequest } from 'fastify'
import { config } from '../config.js'

/**
 * IP del cliente para los limites de intentos (mision 7.5). En DigitalOcean App Platform el
 * proxy de entrada pone la IP real en `do-connecting-ip` y deja en X-Forwarded-For la IP de su
 * propio ingress, por eso TRUST_PROXY no alcanza ahi. Con CLIENT_IP_HEADER configurado se usa
 * ese header; si no viene, se cae a request.ip.
 */
export function getClientIp(request: FastifyRequest) {
  if (config.CLIENT_IP_HEADER) {
    const value = request.headers[config.CLIENT_IP_HEADER]
    const first = (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim()
    if (first) return first.slice(0, 64)
  }
  return request.ip
}
