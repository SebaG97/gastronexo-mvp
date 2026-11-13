import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { config } from '../../config.js'
import { getDatabaseErrorCode } from '../../db/errors.js'
import { pool } from '../../db/pool.js'
import { abortTransaction, withTransaction } from '../../db/transaction.js'
import { getOrganizationAccess, getRoleCapabilities } from '../../security/authorization.js'
import { getClientIp } from '../../security/client-ip.js'
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

// Hash de relleno: si el email no existe se compara igual contra este hash, para que el
// tiempo de respuesta no revele que emails estan registrados (mision 7.1).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('gastronexo-dummy-password', 12)

function normalizedEmailFromBody(body: unknown) {
  if (typeof body === 'object' && body !== null && 'email' in body && typeof body.email === 'string') {
    return body.email.trim().toLowerCase().slice(0, 320)
  }
  return ''
}

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
  // Limites de intentos (mision 7.1). Contadores en memoria: con varias instancias de la API
  // hay que pasarlos a un store compartido (Redis).
  // El 429 lo arma el manejador de errores global (code: 'rate_limited').
  await app.register(rateLimit, { global: false, keyGenerator: getClientIp })

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

  app.post(
    '/register',
    { config: { rateLimit: { max: config.AUTH_REGISTER_MAX_PER_HOUR, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const input = registerSchema.parse(request.body)
      // El hash se calcula antes de tomar una conexion: no retiene un slot del pool mientras corre.
      const passwordHash = await bcrypt.hash(input.password, 12)

      const { user, organization, membership } = await withTransaction(async (client) => {
        const existingUser = await client.query('SELECT 1 FROM users WHERE email = $1', [input.email])
        if (existingUser.rowCount) {
          abortTransaction(409, { message: 'El email ya está registrado.' })
        }

        const existingOrganization = await client.query('SELECT 1 FROM organizations WHERE slug = $1', [
          input.organizationSlug,
        ])
        if (existingOrganization.rowCount) {
          abortTransaction(409, { message: 'El identificador de organización ya está en uso.' })
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

        return { user: user.rows[0], organization: organization.rows[0], membership: membership.rows[0] }
      }).catch((error: unknown) => {
        // Dos registros simultaneos con el mismo email o slug: la base garantiza la unicidad y
        // el perdedor recibe 409 en lugar de 500.
        if (getDatabaseErrorCode(error) === '23505') {
          const constraint =
            typeof error === 'object' && error !== null && 'constraint' in error ? String(error.constraint) : ''
          const message = constraint.includes('slug')
            ? 'El identificador de organización ya está en uso.'
            : 'El email ya está registrado.'
          abortTransaction(409, { message })
        }
        throw error
      })

      const activeMembership = {
        ...membership,
        organizationName: organization.name,
      }
      const token = createToken(app, user.id, activeMembership)

      return reply.code(201).send({
        token,
        user,
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          role: activeMembership.role,
          capabilities: getRoleCapabilities(activeMembership.role),
        },
      })
    },
  )

  app.post(
    '/login',
    {
      config: {
        rateLimit: {
          // Por IP + email, evaluado despues de parsear el body: frena la fuerza bruta contra
          // una cuenta sin bloquear a toda una oficina que comparte IP.
          hook: 'preHandler',
          max: config.AUTH_LOGIN_MAX_ATTEMPTS,
          timeWindow: config.AUTH_LOGIN_WINDOW_MINUTES * 60_000,
          keyGenerator: (request: FastifyRequest) => `${getClientIp(request)}|${normalizedEmailFromBody(request.body)}`,
        },
      },
    },
    async (request, reply) => {
      const input = loginSchema.parse(request.body)
      const userResult = await pool.query<{ id: string; email: string; fullName: string; passwordHash: string }>(
        `SELECT id, email, full_name AS "fullName", password_hash AS "passwordHash"
         FROM users
         WHERE email = $1`,
        [input.email],
      )
      const user = userResult.rows[0]

      const passwordMatches = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
      if (!user || !passwordMatches) {
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
    },
  )
}
