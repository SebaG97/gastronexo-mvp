import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { normalizeOptionalText } from '../orders/orders.service.js'
import { requireOrganizationRole } from '../../security/authorization.js'
import { getDeliveryZones, getStoreByOrganizationId, paymentMethods } from './storefront.service.js'

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional()

const updateSettingsSchema = z.object({
  isEnabled: z.boolean(),
  displayName: optionalText(120),
  tagline: optionalText(200),
  contactPhone: optionalText(40),
  whatsappPhone: optionalText(40),
  contactEmail: z.string().trim().email().max(160).nullable().optional().or(z.literal('')),
  pickupAddress: optionalText(300),
  openingHours: optionalText(300),
  cutoffNotice: optionalText(300),
  minOrderAmount: z.coerce.number().min(0).default(0),
  allowsPickup: z.boolean(),
  allowsDelivery: z.boolean(),
  paymentMethods: z.array(z.enum(paymentMethods)).min(1, 'Elegí al menos una forma de pago.'),
  transferDetails: optionalText(500),
})

const zoneSchema = z.object({
  name: z.string().trim().min(2).max(120),
  fee: z.coerce.number().min(0),
  sortOrder: z.coerce.number().int().min(0).default(0),
})

const updateZoneSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    fee: z.coerce.number().min(0).optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: 'Debe enviar al menos un campo para actualizar.' })

const zoneIdParamsSchema = z.object({ id: z.string().uuid() })

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

async function settingsResponse(organizationId: string) {
  const store = await getStoreByOrganizationId(pool, organizationId)
  const zones = await getDeliveryZones(pool, organizationId, false)
  return { settings: store, zones }
}

export const storefrontAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/settings',
    { preHandler: requireOrganizationRole('owner', 'admin', 'operator', 'viewer') },
    async (request) => settingsResponse(request.organizationAccess!.organization.id),
  )

  app.put(
    '/settings',
    { preHandler: requireOrganizationRole('owner', 'admin') },
    async (request) => {
      const input = updateSettingsSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      await pool.query(
        `INSERT INTO storefront_settings (
           organization_id, is_enabled, display_name, tagline, contact_phone, whatsapp_phone,
           contact_email, pickup_address, opening_hours, cutoff_notice, min_order_amount,
           allows_pickup, allows_delivery, payment_methods, transfer_details
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (organization_id) DO UPDATE SET
           is_enabled = EXCLUDED.is_enabled,
           display_name = EXCLUDED.display_name,
           tagline = EXCLUDED.tagline,
           contact_phone = EXCLUDED.contact_phone,
           whatsapp_phone = EXCLUDED.whatsapp_phone,
           contact_email = EXCLUDED.contact_email,
           pickup_address = EXCLUDED.pickup_address,
           opening_hours = EXCLUDED.opening_hours,
           cutoff_notice = EXCLUDED.cutoff_notice,
           min_order_amount = EXCLUDED.min_order_amount,
           allows_pickup = EXCLUDED.allows_pickup,
           allows_delivery = EXCLUDED.allows_delivery,
           payment_methods = EXCLUDED.payment_methods,
           transfer_details = EXCLUDED.transfer_details,
           updated_at = NOW()`,
        [
          organizationId,
          input.isEnabled,
          normalizeOptionalText(input.displayName),
          normalizeOptionalText(input.tagline),
          normalizeOptionalText(input.contactPhone),
          normalizeOptionalText(input.whatsappPhone),
          normalizeOptionalText(input.contactEmail),
          normalizeOptionalText(input.pickupAddress),
          normalizeOptionalText(input.openingHours),
          normalizeOptionalText(input.cutoffNotice),
          input.minOrderAmount,
          input.allowsPickup,
          input.allowsDelivery,
          [...new Set(input.paymentMethods)],
          normalizeOptionalText(input.transferDetails),
        ],
      )

      return settingsResponse(organizationId)
    },
  )

  app.post(
    '/zones',
    { preHandler: requireOrganizationRole('owner', 'admin') },
    async (request, reply) => {
      const input = zoneSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id
      try {
        await pool.query(
          `INSERT INTO delivery_zones (organization_id, name, fee, sort_order) VALUES ($1, $2, $3, $4)`,
          [organizationId, input.name, input.fee, input.sortOrder],
        )
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe una zona con ese nombre.' })
        }
        throw error
      }
      return reply.code(201).send(await settingsResponse(organizationId))
    },
  )

  app.patch(
    '/zones/:id',
    { preHandler: requireOrganizationRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = zoneIdParamsSchema.parse(request.params)
      const input = updateZoneSchema.parse(request.body)
      const organizationId = request.organizationAccess!.organization.id

      const assignments = ['updated_at = NOW()']
      const params: Array<string | number | boolean> = [organizationId, id]
      const columns = { name: 'name', fee: 'fee', sortOrder: 'sort_order', isActive: 'is_active' } as const
      for (const [field, column] of Object.entries(columns)) {
        const value = input[field as keyof typeof columns]
        if (value !== undefined) {
          params.push(value)
          assignments.push(`${column} = $${params.length}`)
        }
      }

      try {
        const result = await pool.query(
          `UPDATE delivery_zones SET ${assignments.join(', ')} WHERE organization_id = $1 AND id = $2`,
          params,
        )
        if (!result.rowCount) {
          return reply.code(404).send({ message: 'Zona no encontrada.' })
        }
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ message: 'Ya existe una zona con ese nombre.' })
        }
        throw error
      }
      return settingsResponse(organizationId)
    },
  )
}
