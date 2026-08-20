import type { FastifyReply, FastifyRequest } from 'fastify'
import { pool } from '../db/pool.js'
import { membershipRoles, type MembershipRole } from '../modules/auth/auth.types.js'

const INVALID_SESSION_MESSAGE = 'Sesión inválida o expirada.'
const FORBIDDEN_MESSAGE = 'No tenés permisos para realizar esta acción.'

export type OrganizationCapabilities = {
  canReadProducts: boolean
  canWriteProducts: boolean
  canWriteAdmin: boolean
}

export type OrganizationAccessContext = {
  user: {
    id: string
    email: string
    fullName: string
  }
  organization: {
    id: string
    name: string
    slug: string
  }
  role: MembershipRole
  capabilities: OrganizationCapabilities
}

const roleMatrix: Record<MembershipRole, OrganizationCapabilities> = {
  owner: {
    canReadProducts: true,
    canWriteProducts: true,
    canWriteAdmin: true,
  },
  admin: {
    canReadProducts: true,
    canWriteProducts: true,
    canWriteAdmin: true,
  },
  operator: {
    canReadProducts: true,
    canWriteProducts: true,
    canWriteAdmin: false,
  },
  viewer: {
    canReadProducts: true,
    canWriteProducts: false,
    canWriteAdmin: false,
  },
}

export function getRoleCapabilities(role: MembershipRole): OrganizationCapabilities {
  return roleMatrix[role]
}

async function verifyJwtToken(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
    return true
  } catch {
    reply.code(401).send({ message: INVALID_SESSION_MESSAGE })
    return false
  }
}

export async function getOrganizationAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<OrganizationAccessContext | null> {
  if (request.organizationAccess) {
    return request.organizationAccess
  }

  const hasValidToken = await verifyJwtToken(request, reply)
  if (!hasValidToken) {
    return null
  }

  const sessionResult = await pool.query<{
    id: string
    email: string
    fullName: string
    organizationId: string
    organizationName: string
    organizationSlug: string
    role: MembershipRole
  }>(
    `SELECT
      u.id,
      u.email,
      u.full_name AS "fullName",
      o.id AS "organizationId",
      o.name AS "organizationName",
      o.slug AS "organizationSlug",
      m.role
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1
       AND m.organization_id = $2
     LIMIT 1`,
    [request.user.sub, request.user.organizationId],
  )

  const session = sessionResult.rows[0]

  if (!session) {
    reply.code(403).send({ message: FORBIDDEN_MESSAGE })
    return null
  }

  const context: OrganizationAccessContext = {
    user: {
      id: session.id,
      email: session.email,
      fullName: session.fullName,
    },
    organization: {
      id: session.organizationId,
      name: session.organizationName,
      slug: session.organizationSlug,
    },
    role: session.role,
    capabilities: getRoleCapabilities(session.role),
  }

  request.organizationAccess = context
  return context
}

export function requireOrganizationRole(...roles: MembershipRole[]) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply) {
    const allowedRoles = roles.length ? roles : membershipRoles
    const access = await getOrganizationAccess(request, reply)

    if (!access) {
      return
    }

    if (!allowedRoles.includes(access.role)) {
      return reply.code(403).send({ message: FORBIDDEN_MESSAGE })
    }
  }
}