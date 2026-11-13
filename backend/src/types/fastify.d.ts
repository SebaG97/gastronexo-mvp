import '@fastify/jwt'
import type { MembershipRole } from '../modules/auth/auth.types.js'
import type { OrganizationAccessContext } from '../security/authorization.js'

declare module 'fastify' {
  interface FastifyRequest {
    organizationAccess?: OrganizationAccessContext
  }
}

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
