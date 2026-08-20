import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { config } from '../../config.js'
import { pool } from '../../db/pool.js'
import { getOrganizationAccess, getRoleCapabilities } from '../../security/authorization.js'
import type { MembershipRole } from './auth.types.js'

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128),
  organizationName: z.string().trim().min(2).max(120),
  organizationSlug: z
    .string()
    .trim()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})

const loginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
  organizationId: z.string().uuid().optional(),
})

const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
})

type MembershipRecord = {
  organizationId: string
  organizationName: string
  role: MembershipRole
}

function createToken(
  app: Parameters<FastifyPluginAsync>[0],
  userId: string,
  membership: MembershipRecord,
) {
  return app.jwt.sign(
    {
      sub: userId,
      organizationId: membership.organizationId,
      role: membership.role,
    },
    { expiresIn: config.JWT_EXPIRES_IN },
  )
}

async function verifySession(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
    return true
  } catch {
    reply.code(401).send({ message: 'Sesión inválida o expirada.' })
    return false
  }
}

type UserMembershipRow = MembershipRecord & {
  organizationSlug: string
}

async function getUserMemberships(userId: string) {
  return pool.query<UserMembershipRow>(
    `SELECT
      m.organization_id AS "organizationId",
      m.role,
      o.name AS "organizationName",
      o.slug AS "organizationSlug"
     FROM memberships m
     JOIN organizations o ON o.id = m.organization_id
     WHERE m.user_id = $1
     ORDER BY o.created_at ASC`,
    [userId],
  )
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/organizations', async (request, reply) => {
    const isValidSession = await verifySession(request, reply)
    if (!isValidSession) {
      return
    }

    const memberships = await getUserMemberships(request.user.sub)

    return {
      organizations: memberships.rows.map((membership) => ({
        id: membership.organizationId,
        name: membership.organizationName,
        slug: membership.organizationSlug,
        role: membership.role,
        capabilities: getRoleCapabilities(membership.role),
      })),
    }
  })

  app.post('/switch-organization', async (request, reply) => {
    const isValidSession = await verifySession(request, reply)
    if (!isValidSession) {
      return
    }

    const input = switchOrganizationSchema.parse(request.body)

    const membershipResult = await pool.query<UserMembershipRow>(
      `SELECT
        m.organization_id AS "organizationId",
        m.role,
        o.name AS "organizationName",
        o.slug AS "organizationSlug"
       FROM memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1
         AND m.organization_id = $2
       LIMIT 1`,
      [request.user.sub, input.organizationId],
    )

    const membership = membershipResult.rows[0]

    if (!membership) {
      return reply.code(403).send({ message: 'No tenés permisos para realizar esta acción.' })
    }

    return {
      token: createToken(app, request.user.sub, membership),
      organization: {
        id: membership.organizationId,
        name: membership.organizationName,
        slug: membership.organizationSlug,
        role: membership.role,
        capabilities: getRoleCapabilities(membership.role),
      },
    }
  })

  app.get('/me', async (request, reply) => {
    const access = await getOrganizationAccess(request, reply)
    if (!access) {
      return
    }

    return {
      user: access.user,
      organization: {
        id: access.organization.id,
        name: access.organization.name,
        slug: access.organization.slug,
        role: access.role,
        capabilities: access.capabilities,
      },
    }
  })

  app.get('/permissions', async (request, reply) => {
    const access = await getOrganizationAccess(request, reply)
    if (!access) {
      return
    }

    return {
      organization: {
        id: access.organization.id,
        role: access.role,
      },
      capabilities: access.capabilities,
    }
  })

  app.post('/register', async (request, reply) => {
    const input = registerSchema.parse(request.body)
    const passwordHash = await bcrypt.hash(input.password, 12)
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const existingUser = await client.query('SELECT 1 FROM users WHERE email = $1', [input.email])
      if (existingUser.rowCount) {
        return reply.code(409).send({ message: 'El email ya está registrado.' })
      }

      const existingOrganization = await client.query('SELECT 1 FROM organizations WHERE slug = $1', [
        input.organizationSlug,
      ])
      if (existingOrganization.rowCount) {
        return reply.code(409).send({ message: 'El identificador de organización ya está en uso.' })
      }

      const user = await client.query<{ id: string; email: string; fullName: string }>(
        `INSERT INTO users (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, full_name AS "fullName"`,
        [input.email, passwordHash, input.fullName],
      )
      const organization = await client.query<{ id: string; name: string; slug: string }>(
        `INSERT INTO organizations (name, slug)
         VALUES ($1, $2)
         RETURNING id, name, slug`,
        [input.organizationName, input.organizationSlug],
      )
      const membership = await client.query<MembershipRecord>(
        `INSERT INTO memberships (user_id, organization_id, role)
         VALUES ($1, $2, 'owner')
         RETURNING organization_id AS "organizationId", 'owner'::membership_role AS role`,
        [user.rows[0].id, organization.rows[0].id],
      )

      await client.query('COMMIT')

      const activeMembership = {
        ...membership.rows[0],
        organizationName: organization.rows[0].name,
      }
      const token = createToken(app, user.rows[0].id, activeMembership)

      return reply.code(201).send({
        token,
        user: user.rows[0],
        organization: {
          id: organization.rows[0].id,
          name: organization.rows[0].name,
          slug: organization.rows[0].slug,
          role: activeMembership.role,
          capabilities: getRoleCapabilities(activeMembership.role),
        },
      })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  app.post('/login', async (request, reply) => {
    const input = loginSchema.parse(request.body)
    const userResult = await pool.query<{ id: string; email: string; fullName: string; passwordHash: string }>(
      `SELECT id, email, full_name AS "fullName", password_hash AS "passwordHash"
       FROM users
       WHERE email = $1`,
      [input.email],
    )
    const user = userResult.rows[0]

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      return reply.code(401).send({ message: 'Email o contraseña incorrectos.' })
    }

    const memberships = await getUserMemberships(user.id)

    const activeMembership =
      memberships.rows.find((membership) => membership.organizationId === input.organizationId) ??
      memberships.rows[0]

    if (!activeMembership) {
      return reply.code(403).send({ message: 'El usuario no pertenece a ninguna organización.' })
    }

    return {
      token: createToken(app, user.id, activeMembership),
      user: { id: user.id, email: user.email, fullName: user.fullName },
      organization: {
        id: activeMembership.organizationId,
        name: activeMembership.organizationName,
        slug: activeMembership.organizationSlug,
        role: activeMembership.role,
        capabilities: getRoleCapabilities(activeMembership.role),
      },
      organizations: memberships.rows.map((membership) => ({
        id: membership.organizationId,
        name: membership.organizationName,
        slug: membership.organizationSlug,
        role: membership.role,
        capabilities: getRoleCapabilities(membership.role),
      })),
    }
  })
}
