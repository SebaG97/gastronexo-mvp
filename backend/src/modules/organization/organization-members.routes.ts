import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { requireOrganizationRole } from '../../security/authorization.js'
import type { MembershipRole } from '../auth/auth.types.js'

const FORBIDDEN_MESSAGE = 'No tenés permisos para realizar esta acción.'
const NOT_FOUND_MEMBER_MESSAGE = 'No se encontró el miembro solicitado.'
const LAST_OWNER_MESSAGE = 'No se puede modificar al último owner de la organización.'

const addMemberSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  role: z.enum(['operator', 'viewer']),
})

const updateMemberParamsSchema = z.object({
  userId: z.string().uuid(),
})

const updateMemberSchema = z.object({
  role: z.enum(['admin', 'operator', 'viewer']),
})

type MemberRow = {
  userId: string
  fullName: string
  email: string
  role: MembershipRole
}

function canActorManageAdminTransitions(
  actorRole: MembershipRole,
  currentRole: MembershipRole,
  nextRole: MembershipRole,
) {
  const touchesAdmin = currentRole === 'admin' || nextRole === 'admin'
  if (!touchesAdmin) {
    return true
  }

  return actorRole === 'owner'
}

function canActorUpdateMemberRole(
  actorRole: MembershipRole,
  currentRole: MembershipRole,
  nextRole: MembershipRole,
  ownerCount: number,
) {
  if (!canActorManageAdminTransitions(actorRole, currentRole, nextRole)) {
    return false
  }

  if (currentRole === 'owner') {
    if (actorRole !== 'owner') {
      return false
    }

    if (ownerCount <= 1) {
      return false
    }
  }

  return true
}

function canActorRevokeMember(
  actorRole: MembershipRole,
  targetRole: MembershipRole,
  isSelf: boolean,
  ownerCount: number,
) {
  if (isSelf && actorRole === 'owner') {
    return false
  }

  if (targetRole === 'owner' && ownerCount <= 1) {
    return false
  }

  if (targetRole === 'admin' && actorRole !== 'owner') {
    return false
  }

  if (targetRole === 'owner' && actorRole !== 'owner') {
    return false
  }

  return true
}

function getAssignableRolesForMember(
  actorRole: MembershipRole,
  currentRole: MembershipRole,
  ownerCount: number,
) {
  const assignableRoles: Array<'admin' | 'operator' | 'viewer'> = []

  for (const role of ['admin', 'operator', 'viewer'] as const) {
    if (role === currentRole) {
      continue
    }

    if (canActorUpdateMemberRole(actorRole, currentRole, role, ownerCount)) {
      assignableRoles.push(role)
    }
  }

  return assignableRoles
}

async function countOwnersInOrganization(client: Pick<typeof pool, 'query'>, organizationId: string) {
  const ownerCountResult = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM memberships
     WHERE organization_id = $1
       AND role = 'owner'`,
    [organizationId],
  )

  return Number(ownerCountResult.rows[0]?.count ?? '0')
}

async function rollbackTransaction(client: Pick<typeof pool, 'query'>) {
  try {
    await client.query('ROLLBACK')
  } catch {
    return
  }
}

export const organizationMembersRoutes: FastifyPluginAsync = async (app) => {
  app.get('/members', { preHandler: requireOrganizationRole('owner', 'admin') }, async (request) => {
    const organizationId = request.organizationAccess!.organization.id
    const actor = request.organizationAccess!.user
    const actorRole = request.organizationAccess!.role

    const [membersResult, ownerCount] = await Promise.all([
      pool.query<MemberRow>(
        `SELECT
          u.id AS "userId",
          u.full_name AS "fullName",
          u.email,
          m.role
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1
         ORDER BY u.full_name ASC`,
        [organizationId],
      ),
      countOwnersInOrganization(pool, organizationId),
    ])

    return {
      members: membersResult.rows.map((member) => {
        const assignableRoles = getAssignableRolesForMember(actorRole, member.role, ownerCount)

        return {
          userId: member.userId,
          fullName: member.fullName,
          email: member.email,
          role: member.role,
          actions: {
            canChangeRole: assignableRoles.length > 0,
            assignableRoles,
            canRevoke: canActorRevokeMember(
              actorRole,
              member.role,
              member.userId === actor.id,
              ownerCount,
            ),
          },
        }
      }),
    }
  })

  app.post('/members', { preHandler: requireOrganizationRole('owner', 'admin') }, async (request, reply) => {
    const input = addMemberSchema.parse(request.body)
    const organizationId = request.organizationAccess!.organization.id
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const userResult = await client.query<{ id: string; fullName: string; email: string }>(
        `SELECT id, full_name AS "fullName", email
         FROM users
         WHERE email = $1
         LIMIT 1`,
        [input.email],
      )

      const user = userResult.rows[0]

      if (!user) {
        await rollbackTransaction(client)
        return reply.code(404).send({ message: 'No se encontró un usuario con ese email.' })
      }

      const existingMembership = await client.query<{ role: MembershipRole }>(
        `SELECT role
         FROM memberships
         WHERE user_id = $1
           AND organization_id = $2
         LIMIT 1`,
        [user.id, organizationId],
      )

      if (existingMembership.rowCount) {
        await rollbackTransaction(client)
        return reply.code(409).send({ message: 'El usuario ya pertenece a la organización.' })
      }

      const membershipResult = await client.query<{ role: MembershipRole }>(
        `INSERT INTO memberships (user_id, organization_id, role)
         VALUES ($1, $2, $3)
         RETURNING role`,
        [user.id, organizationId, input.role],
      )

      await client.query('COMMIT')

      return reply.code(201).send({
        member: {
          userId: user.id,
          fullName: user.fullName,
          email: user.email,
          role: membershipResult.rows[0].role,
        },
      })
    } catch (error) {
      await rollbackTransaction(client)
      throw error
    } finally {
      client.release()
    }
  })

  app.patch(
    '/members/:userId',
    { preHandler: requireOrganizationRole('owner', 'admin') },
    async (request, reply) => {
      const params = updateMemberParamsSchema.parse(request.params)
      const input = updateMemberSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      const actorRole = request.organizationAccess!.role
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const targetMembershipResult = await client.query<{ role: MembershipRole }>(
          `SELECT role
           FROM memberships
           WHERE user_id = $1
             AND organization_id = $2
           FOR UPDATE`,
          [params.userId, organizationId],
        )

        const targetMembership = targetMembershipResult.rows[0]

        if (!targetMembership) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: NOT_FOUND_MEMBER_MESSAGE })
        }

        const ownerCount = await countOwnersInOrganization(client, organizationId)

        if (
          !canActorUpdateMemberRole(actorRole, targetMembership.role, input.role, ownerCount)
        ) {
          await rollbackTransaction(client)

          if (targetMembership.role === 'owner' && ownerCount <= 1) {
            return reply.code(409).send({ message: LAST_OWNER_MESSAGE })
          }

          return reply.code(403).send({ message: FORBIDDEN_MESSAGE })
        }

        const updateResult = await client.query<{ role: MembershipRole }>(
          `UPDATE memberships
           SET role = $3
           WHERE user_id = $1
             AND organization_id = $2
           RETURNING role`,
          [params.userId, organizationId, input.role],
        )

        await client.query('COMMIT')

        return {
          member: {
            userId: params.userId,
            role: updateResult.rows[0].role,
          },
        }
      } catch (error) {
        await rollbackTransaction(client)
        throw error
      } finally {
        client.release()
      }
    },
  )

  app.delete(
    '/members/:userId',
    { preHandler: requireOrganizationRole('owner', 'admin') },
    async (request, reply) => {
      const params = updateMemberParamsSchema.parse(request.params)
      const organizationId = request.organizationAccess!.organization.id
      const actorId = request.organizationAccess!.user.id
      const actorRole = request.organizationAccess!.role
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const targetMembershipResult = await client.query<{ role: MembershipRole }>(
          `SELECT role
           FROM memberships
           WHERE user_id = $1
             AND organization_id = $2
           FOR UPDATE`,
          [params.userId, organizationId],
        )

        const targetMembership = targetMembershipResult.rows[0]

        if (!targetMembership) {
          await rollbackTransaction(client)
          return reply.code(404).send({ message: NOT_FOUND_MEMBER_MESSAGE })
        }

        const ownerCount = await countOwnersInOrganization(client, organizationId)
        const canRevoke = canActorRevokeMember(
          actorRole,
          targetMembership.role,
          params.userId === actorId,
          ownerCount,
        )

        if (!canRevoke) {
          await rollbackTransaction(client)

          if (targetMembership.role === 'owner' && ownerCount <= 1) {
            return reply.code(409).send({ message: LAST_OWNER_MESSAGE })
          }

          return reply.code(403).send({ message: FORBIDDEN_MESSAGE })
        }

        await client.query(
          `DELETE FROM memberships
           WHERE user_id = $1
             AND organization_id = $2`,
          [params.userId, organizationId],
        )

        await client.query('COMMIT')

        return reply.code(204).send()
      } catch (error) {
        await rollbackTransaction(client)
        throw error
      } finally {
        client.release()
      }
    },
  )
}
