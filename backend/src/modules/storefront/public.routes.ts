import rateLimit from '@fastify/rate-limit'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { pool } from '../../db/pool.js'
import { abortTransaction, withTransaction, type DbClient } from '../../db/transaction.js'
import {
  getNextOrderNumber,
  normalizeOptionalText,
  orderItemSchema,
  prepareOrderItems,
  replaceOrderItems,
} from '../orders/orders.service.js'
import {
  availabilityFrom,
  availableStockSql,
  buildQuote,
  createPublicToken,
  getDeliveryZones,
  getEnabledStoreBySlug,
  normalizePhone,
  paymentMethods,
  publicStore,
  upsertStorefrontCustomer,
  type StoreRow,
} from './storefront.service.js'

// Endpoints publicos de la tienda: sin JWT, siempre acotados a una organizacion por slug.

const slugParamsSchema = z.object({ slug: z.string().trim().min(1).max(120) })

const listProductsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  categoryId: z.string().uuid().optional(),
  sort: z.enum(['name', 'price_asc', 'price_desc']).default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(48),
})

const publicItemsSchema = z.array(orderItemSchema).min(1).max(100)

const quoteSchema = z.object({
  items: publicItemsSchema,
  fulfillmentType: z.enum(['pickup', 'delivery']).optional(),
  deliveryZoneId: z.string().uuid().nullable().optional(),
})

const createOrderSchema = z
  .object({
    contact: z.object({
      name: z.string().trim().min(2).max(120),
      phone: z
        .string()
        .trim()
        .max(40)
        .refine((value) => normalizePhone(value).length >= 6, 'Ingresá un teléfono válido.'),
      email: z.string().trim().email().max(160).nullable().optional(),
    }),
    fulfillment: z.object({
      type: z.enum(['pickup', 'delivery']),
      deliveryZoneId: z.string().uuid().nullable().optional(),
      address: z.string().trim().max(300).nullable().optional(),
      reference: z.string().trim().max(300).nullable().optional(),
      requestedDate: z.coerce.date().nullable().optional(),
    }),
    payment: z.object({
      method: z.enum(paymentMethods),
      cashChangeFor: z.coerce.number().min(0).nullable().optional(),
    }),
    notes: z.string().trim().max(500).nullable().optional(),
    items: publicItemsSchema,
    expectedTotal: z.coerce.number().min(0),
    // Honeypot: un humano nunca lo completa (el campo esta oculto en el formulario).
    website: z.string().max(0).optional(),
  })
  .refine(
    (input) =>
      input.fulfillment.type === 'pickup' ||
      (Boolean(input.fulfillment.deliveryZoneId) && (input.fulfillment.address?.length ?? 0) >= 5),
    { path: ['fulfillment'], message: 'Para envío elegí la zona y escribí la dirección.' },
  )

const idempotencyKeySchema = z.string().trim().min(8).max(100)

const orderTokenParamsSchema = z.object({
  slug: z.string().trim().min(1).max(120),
  token: z.string().trim().min(10).max(80),
})

function isIdempotencyConflict(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'orders_org_idempotency_key_unique'
  )
}

async function findOrderByIdempotencyKey(client: DbClient, organizationId: string, key: string) {
  const result = await client.query<{ orderNumber: string; publicToken: string }>(
    `SELECT order_number AS "orderNumber", public_token AS "publicToken"
     FROM orders
     WHERE organization_id = $1 AND idempotency_key = $2`,
    [organizationId, key],
  )
  return result.rows[0] ?? null
}

async function getPublicOrder(client: DbClient, store: StoreRow, token: string) {
  const orderResult = await client.query(
    `SELECT
       o.id,
       o.order_number AS "orderNumber",
       o.status,
       o.subtotal::text AS subtotal,
       o.delivery_fee::text AS "deliveryFee",
       o.total::text AS total,
       o.fulfillment_type AS "fulfillmentType",
       o.delivery_zone_name AS "deliveryZoneName",
       o.delivery_address AS "deliveryAddress",
       o.requested_delivery_date AS "requestedDeliveryDate",
       o.payment_method AS "paymentMethod",
       o.cash_change_for::text AS "cashChangeFor",
       o.contact_name AS "contactName",
       o.notes,
       o.created_at AS "createdAt"
     FROM orders o
     WHERE o.organization_id = $1
       AND o.public_token = $2
       AND o.channel = 'storefront'`,
    [store.organizationId, token],
  )
  const order = orderResult.rows[0]
  if (!order) {
    return null
  }

  const itemsResult = await client.query(
    `SELECT
       product_name_snapshot AS name,
       product_unit_snapshot AS unit,
       cut_name_snapshot AS "cutName",
       quantity::text AS quantity,
       (unit_price + cut_price_modifier)::text AS "unitPrice",
       subtotal::text AS subtotal
     FROM order_items
     WHERE organization_id = $1 AND order_id = $2
     ORDER BY created_at ASC`,
    [store.organizationId, order.id],
  )

  const { id: _id, ...publicOrder } = order
  return { ...publicOrder, items: itemsResult.rows }
}

export const publicStorefrontRoutes: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => ({
      statusCode: context.statusCode,
      message: 'Demasiados intentos seguidos. Esperá un momento y volvé a intentar.',
      code: 'rate_limited',
    }),
  })

  async function requireStore(slug: string) {
    const store = await getEnabledStoreBySlug(pool, slug)
    if (!store) {
      abortTransaction(404, { message: 'Esta tienda no existe o no está disponible.', code: 'store_not_found' })
    }
    return store
  }

  app.get('/:slug/store', async (request) => {
    const { slug } = slugParamsSchema.parse(request.params)
    const store = await requireStore(slug)
    const zones = await getDeliveryZones(pool, store.organizationId, true)
    return { store: publicStore(store, zones) }
  })

  app.get('/:slug/categories', async (request) => {
    const { slug } = slugParamsSchema.parse(request.params)
    const store = await requireStore(slug)
    const result = await pool.query(
      `SELECT c.id, c.name, COUNT(p.id)::int AS "productCount"
       FROM product_categories c
       JOIN products p
         ON p.category_id = c.id
        AND p.organization_id = c.organization_id
        AND p.is_active = true
        AND p.is_sellable = true
        AND p.is_catalog_visible = true
        AND p.sale_price > 0
       WHERE c.organization_id = $1
         AND c.is_active = true
       GROUP BY c.id, c.name
       ORDER BY c.name ASC`,
      [store.organizationId],
    )
    return { categories: result.rows }
  })

  async function listCatalog(store: StoreRow, filters: { q?: string; categoryId?: string; productId?: string }, sort: string, limit: number, offset: number) {
    const where = [
      'p.organization_id = $1',
      'p.is_active = true',
      'p.is_sellable = true',
      'p.is_catalog_visible = true',
      'p.sale_price > 0',
    ]
    const params: Array<string | number> = [store.organizationId]
    if (filters.q) {
      params.push(`%${filters.q}%`)
      where.push(`(p.name ILIKE $${params.length} OR COALESCE(p.description, '') ILIKE $${params.length})`)
    }
    if (filters.categoryId) {
      params.push(filters.categoryId)
      where.push(`p.category_id = $${params.length}`)
    }
    if (filters.productId) {
      params.push(filters.productId)
      where.push(`p.id = $${params.length}`)
    }

    const orderBy =
      sort === 'price_asc' ? 'p.sale_price ASC, p.name ASC' : sort === 'price_desc' ? 'p.sale_price DESC, p.name ASC' : 'p.name ASC'

    const totalResult = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM products p WHERE ${where.join(' AND ')}`,
      params,
    )

    const listParams = [...params, limit, offset]
    const productsResult = await pool.query<{
      id: string
      name: string
      description: string | null
      imageUrl: string | null
      unit: string
      price: string
      categoryId: string | null
      categoryName: string | null
      available: string
    }>(
      `SELECT
         p.id,
         p.name,
         p.description,
         p.image_url AS "imageUrl",
         p.unit,
         p.sale_price::text AS price,
         p.category_id AS "categoryId",
         c.name AS "categoryName",
         (${availableStockSql})::text AS available
       FROM products p
       LEFT JOIN product_categories c
         ON c.id = p.category_id
        AND c.organization_id = p.organization_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT $${listParams.length - 1}
       OFFSET $${listParams.length}`,
      listParams,
    )

    const productIds = productsResult.rows.map((product) => product.id)
    const cutsResult = productIds.length
      ? await pool.query<{ productId: string; id: string; name: string; priceModifier: string; isDefault: boolean }>(
          `SELECT
             pco.product_id AS "productId",
             ct.id,
             ct.name,
             pco.price_modifier::text AS "priceModifier",
             pco.is_default AS "isDefault"
           FROM product_cut_options pco
           JOIN cut_types ct
             ON ct.id = pco.cut_type_id
            AND ct.organization_id = pco.organization_id
            AND ct.is_active = true
           WHERE pco.organization_id = $1
             AND pco.product_id = ANY($2::uuid[])
             AND pco.is_active = true
           ORDER BY pco.sort_order ASC, ct.name ASC`,
          [store.organizationId, productIds],
        )
      : { rows: [] }

    const products = productsResult.rows.map(({ available, ...product }) => ({
      ...product,
      availability: availabilityFrom(Number(available)),
      cuts: cutsResult.rows
        .filter((cut) => cut.productId === product.id)
        .map(({ productId: _productId, ...cut }) => cut),
    }))

    return { products, total: Number(totalResult.rows[0]?.total ?? 0) }
  }

  app.get('/:slug/products', async (request) => {
    const { slug } = slugParamsSchema.parse(request.params)
    const query = listProductsQuerySchema.parse(request.query)
    const store = await requireStore(slug)
    const { products, total } = await listCatalog(
      store,
      { q: query.q, categoryId: query.categoryId },
      query.sort,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    )
    return {
      products,
      pagination: {
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    }
  })

  app.get('/:slug/products/:id', async (request, reply) => {
    const { slug, id } = z
      .object({ slug: z.string().trim().min(1).max(120), id: z.string().uuid() })
      .parse(request.params)
    const store = await requireStore(slug)
    const { products } = await listCatalog(store, { productId: id }, 'name', 1, 0)
    if (!products[0]) {
      return reply.code(404).send({ message: 'Este producto ya no está disponible.' })
    }
    return { product: products[0] }
  })

  app.post(
    '/:slug/cart/quote',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const { slug } = slugParamsSchema.parse(request.params)
      const input = quoteSchema.parse(request.body)
      const store = await requireStore(slug)
      return { quote: await buildQuote(pool, store, input) }
    },
  )

  app.post(
    '/:slug/orders',
    { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const { slug } = slugParamsSchema.parse(request.params)
      const idempotencyKey = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
      if (!idempotencyKey.success) {
        return reply.code(400).send({ message: 'Falta el identificador del intento de compra.', code: 'idempotency_key_required' })
      }
      const input = createOrderSchema.parse(request.body)
      const store = await requireStore(slug)
      const key = idempotencyKey.data

      const previous = await findOrderByIdempotencyKey(pool, store.organizationId, key)
      if (previous) {
        return reply.code(200).send({ order: previous, replayed: true })
      }

      try {
        const created = await withTransaction(async (client) => {
          const fulfillmentType = input.fulfillment.type
          if (!store.paymentMethods.includes(input.payment.method)) {
            abortTransaction(400, { message: 'Esa forma de pago no está disponible.', code: 'payment_method_unavailable' })
          }

          const quote = await buildQuote(client, store, {
            items: input.items,
            fulfillmentType,
            deliveryZoneId: input.fulfillment.deliveryZoneId,
          })

          if (quote.fulfillmentError) {
            abortTransaction(409, { message: quote.fulfillmentError, code: 'fulfillment_unavailable', quote })
          }
          if (quote.hasIssues) {
            abortTransaction(409, {
              message: 'Algunos productos de tu carrito cambiaron. Revisalos antes de enviar el pedido.',
              code: 'cart_changed',
              quote,
            })
          }
          if (!quote.meetsMinimum) {
            abortTransaction(400, {
              message: `El pedido mínimo es de Gs. ${new Intl.NumberFormat('es-PY').format(quote.minOrderAmount)} sin contar el envío.`,
              code: 'below_minimum',
              quote,
            })
          }
          if (Math.abs(quote.total - input.expectedTotal) > 0.009) {
            abortTransaction(409, {
              message: 'Los precios cambiaron desde que armaste el carrito. Revisá el nuevo total.',
              code: 'price_changed',
              quote,
            })
          }

          const cashChangeFor = input.payment.method === 'cash' ? (input.payment.cashChangeFor ?? null) : null
          if (cashChangeFor !== null && cashChangeFor < quote.total) {
            abortTransaction(400, {
              message: 'El monto con el que vas a pagar tiene que cubrir el total.',
              code: 'cash_change_too_low',
            })
          }

          // Validacion estricta del motor de pedidos (misma que la consola).
          const prepared = await prepareOrderItems(client, store.organizationId, input.items, { storefront: true })
          if (!prepared.ok) {
            abortTransaction(prepared.statusCode, { message: prepared.message })
          }

          const contact = {
            name: input.contact.name,
            phone: input.contact.phone,
            email: normalizeOptionalText(input.contact.email),
          }
          const customerId = await upsertStorefrontCustomer(client, store.organizationId, contact)
          const orderNumber = await getNextOrderNumber(client, store.organizationId)
          const publicToken = createPublicToken()
          const requestedDate = input.fulfillment.requestedDate
            ? input.fulfillment.requestedDate.toISOString().slice(0, 10)
            : null

          const orderResult = await client.query<{ id: string }>(
            `INSERT INTO orders (
               organization_id, order_number, customer_id, requested_delivery_date, notes,
               subtotal, total, created_by, channel, fulfillment_type, delivery_zone_id,
               delivery_zone_name, delivery_fee, delivery_address, delivery_reference,
               payment_method, cash_change_for, contact_name, contact_phone, contact_email,
               public_token, idempotency_key
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 'storefront', $8, $9, $10, $11, $12, $13,
                     $14, $15, $16, $17, $18, $19, $20)
             RETURNING id`,
            [
              store.organizationId,
              orderNumber,
              customerId,
              requestedDate,
              normalizeOptionalText(input.notes),
              prepared.subtotal,
              Number((prepared.subtotal + quote.deliveryFee).toFixed(2)),
              fulfillmentType,
              quote.deliveryZone?.id ?? null,
              quote.deliveryZone?.name ?? null,
              quote.deliveryFee,
              fulfillmentType === 'delivery' ? normalizeOptionalText(input.fulfillment.address) : null,
              fulfillmentType === 'delivery' ? normalizeOptionalText(input.fulfillment.reference) : null,
              input.payment.method,
              cashChangeFor,
              contact.name,
              contact.phone,
              contact.email,
              publicToken,
              key,
            ],
          )

          const orderId = orderResult.rows[0].id
          const itemsResult = await replaceOrderItems(client, store.organizationId, orderId, input.items, {
            storefront: true,
          })
          if (!itemsResult.ok) {
            abortTransaction(itemsResult.statusCode, { message: itemsResult.message })
          }

          await client.query(
            `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by)
             VALUES ($1, NULL, 'new', NULL)`,
            [orderId],
          )

          return { orderNumber, publicToken }
        })

        return reply.code(201).send({ order: created, replayed: false })
      } catch (error) {
        // Dos envios simultaneos con la misma clave: el segundo devuelve el pedido del primero.
        if (isIdempotencyConflict(error)) {
          const existing = await findOrderByIdempotencyKey(pool, store.organizationId, key)
          if (existing) {
            return reply.code(200).send({ order: existing, replayed: true })
          }
        }
        throw error
      }
    },
  )

  app.get('/:slug/orders/:token', async (request, reply) => {
    const { slug, token } = orderTokenParamsSchema.parse(request.params)
    const store = await requireStore(slug)
    const order = await getPublicOrder(pool, store, token)
    if (!order) {
      return reply.code(404).send({ message: 'No encontramos ese pedido.' })
    }
    return { order }
  })
}
