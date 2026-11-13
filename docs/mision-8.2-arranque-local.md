# Misión 8.2 - Arranque local con un solo comando

## Objetivo

Que cualquiera pueda clonar el repo y tener Gastronexo andando en local sin seguir una receta de 5 pasos en dos terminales.

## Comandos (desde la raíz)

| Comando | Qué hace |
| --- | --- |
| `npm run setup` | Verifica Node (22 recomendado) y Docker. Levanta PostgreSQL y espera a que esté sano. Crea `backend/.env` (base de Docker y `JWT_SECRET` aleatorio) y `frontend/.env` **solo si no existen**. Instala dependencias y migra. Se puede repetir. |
| `npm run dev` | Asegura PostgreSQL y levanta API y consola en una terminal, con la salida prefijada `[api]` / `[web]`. Ctrl+C, o la caída de cualquiera de las dos partes, cierra todo (en Windows con `taskkill /T`, en macOS/Linux matando el grupo de procesos). |
| `npm run demo` | Con `dev` corriendo: crea o reutiliza la cuenta `demo@gastronexo.test` / `demo-gastronexo-123`, carga catálogo, stock y tienda (`seed-storefront-demo.mjs`) y un pedido de ejemplo de la tienda que respeta cortes por defecto y el pedido mínimo. Se puede repetir. |

Son scripts en Node puro (`scripts/*.mjs`), sin dependencias nuevas.

## Corrección encontrada

`backend/.env.example` tenía `DATABASE_URL=postgresql://user:password@localhost:5432/gastronexo`, que no coincide con `docker-compose.yml`: quien siguiera el README desde cero no se conectaba. Ahora el ejemplo trae los datos de Docker.

## Verificación

- **Clon nuevo del repo** (sin `.env` ni `node_modules`) en una carpeta temporal:
  - `npm run setup` terminó OK y creó los dos `.env`, con el `DATABASE_URL` de Docker y sin el `JWT_SECRET` de ejemplo;
  - `npm run dev` levantó la API (`/ready` 200) y la consola (200);
  - al matar el proceso de la consola, `dev` cerró también la API y terminó, sin procesos colgados.
- `npm run demo` dos veces seguidas: la primera crea la cuenta, la tienda y el pedido `PED-000001`. La segunda reutiliza todo y no duplica nada.
- No se probó un Ctrl+C real desde una terminal interactiva: el cierre se verificó por la otra vía, con el mismo `killTree`. Tampoco se probó en macOS/Linux.
