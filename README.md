# Gastronexo MVP

Base frontend para una consola operativa de gestión gastronómica.

## Inicio rápido

```bash
cd frontend
npm install
npm run dev
```

## Build de producción

```bash
cd frontend
npm run build
```

La documentación de diseño y alcance está disponible en `docs/`.

## Desarrollo local

### Requisitos

- Node.js
- npm
- Docker Desktop

### Preparar entorno

1. Copiar variables de entorno del backend:

	```bash
	cp backend/.env.example backend/.env
	```

2. Levantar PostgreSQL local:

	```bash
	docker compose up -d
	```

3. Instalar dependencias del backend y ejecutar migraciones:

	```bash
	cd backend
	npm install
	npm run db:migrate
	npm run dev
	```

### Detener y reiniciar PostgreSQL

- Detener:

  ```bash
  docker compose down
  ```

- Reiniciar:

  ```bash
  docker compose restart postgres
  ```

### Reiniciar desde cero (eliminar datos locales)

> ⚠️ Este comando elimina **solo** el volumen local de PostgreSQL de Gastronexo y se perderán los datos locales.

```bash
docker compose down
docker volume rm gastronexo-mvp_gastronexo_postgres_data
docker compose up -d
```
