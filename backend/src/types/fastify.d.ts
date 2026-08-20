import '@fastify/jwt'
import type { MembershipRole } from '../modules/auth/auth.types.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string
      organizationId: string
      role: MembershipRole
    }
    user: {
      sub: string
      organizationId: string
      role: MembershipRole
    }
  }
}
