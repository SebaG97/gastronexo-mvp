// Mision 8.12: la sesion del navegador viaja en una cookie HttpOnly, no en localStorage.
//
// - HttpOnly: ningun script de la pagina (ni uno inyectado por XSS o una extension) puede leerla.
// - SameSite=Lax + Secure en produccion + Path=/api.
// - El header Authorization: Bearer sigue funcionando (scripts, integraciones): @fastify/jwt mira
//   primero el header y, si no hay, la cookie.
// - CSRF: con sesion por cookie, toda escritura exige el header X-Gastronexo-Client. Un formulario
//   de otro sitio no puede mandarlo, y un fetch de otro origen con ese header necesita un
//   preflight CORS que solo aceptamos para FRONTEND_ORIGIN.

import '@fastify/cookie'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config.js'

export const SESSION_COOKIE = 'gx_session'
export const CLIENT_HEADER = 'x-gastronexo-client'

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

function expiresInSeconds() {
  const match = /^(\d+)(s|m|h|d)$/i.exec(config.JWT_EXPIRES_IN)
  return match ? Number(match[1]) * UNIT_SECONDS[match[2].toLowerCase()] : 8 * 3600
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.NODE_ENV === 'production',
  path: '/api',
})

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: expiresInSeconds() })
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, cookieOptions())
}

/**
 * El JWT en el cuerpo de la respuesta es para scripts e integraciones. Al navegador (que manda
 * X-Gastronexo-Client: web) no se le devuelve: le alcanza con la cookie, que no puede leer.
 */
export function tokenForBody(request: FastifyRequest, token: string) {
  return request.headers[CLIENT_HEADER] === 'web' ? undefined : token
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** onRequest: rechaza escrituras con sesion por cookie que no traen el header del cliente web. */
export async function csrfGuard(request: FastifyRequest, reply: FastifyReply) {
  if (SAFE_METHODS.has(request.method)) return
  if (request.headers.authorization) return // sesion por header: no la manda el navegador solo
  if (!request.cookies?.[SESSION_COOKIE]) return // sin sesion: la ruta decide (401 o publica)
  if (request.headers[CLIENT_HEADER] === 'web') return
  return reply.code(403).send({ message: 'Pedido rechazado por seguridad. Recargá la página e intentá de nuevo.', code: 'csrf' })
}
