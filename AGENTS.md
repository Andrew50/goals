# Repo Agent Guide

This repository defines a multi-service application using Docker Compose. The following compose files describe the environments:

- `docker-compose.dev.yaml` – development setup.
- `docker-compose.prod.yaml` – production deployment.
- `docker-compose.test.yaml` – adds a dedicated test database for automated tests.

## Services

### goals_backend
Rust based backend located in `backend/`. The dev Dockerfile (`backend/Dockerfile.dev`) installs `cargo-watch` and runs the server with automatic rebuilding. The production Dockerfile (`backend/Dockerfile.prod`) compiles the app in a builder stage and uses a small runtime image.

### goals_db
Neo4j database located in `db/`. The production configuration (`db/Dockerfile.prod`) installs cron and backup scripts. The dev setup (`db/Dockerfile.dev`) simply runs Neo4j with default credentials. A `start.sh` script starts the database and cron service.

### goals_frontend
React frontend located in `frontend/`. The dev Dockerfile (`frontend/Dockerfile.dev`) exposes the development server at port 3000. The production Dockerfile (`frontend/Dockerfile.prod`) builds a static bundle served with `serve`.

### goals_router (entrypoint)
Nginx container defined in `router/`. Acts as the entrypoint in production, forwarding `/api/` requests to the backend and everything else to the frontend. See `router/Dockerfile.prod` and `router/nginx.conf`.

### goals_cloudflared
Optional Cloudflare tunnel used in production. Defined in `docker-compose.prod.yaml` and runs `cloudflared` with a token.

### goals_db_test
Test database used only with `docker-compose.test.yaml`. Seeds data using `db/seed_test_db.sh`.

### Lint
There is no dedicated lint container. Linting is performed in GitHub workflows (`.github/workflows/pr-checks.yml`) where Rust code is formatted and checked with `cargo clippy`, and the frontend is linted with ESLint and TypeScript.

## Running the stack
- **Development**: `docker compose -f docker-compose.dev.yaml up -d`
- **Testing**: `docker compose -f docker-compose.dev.yaml -f docker-compose.test.yaml up -d`
- **Production**: `docker compose -f docker-compose.prod.yaml up -d`

## Notes
- Backend and database services expose their ports so other services can reach them. The router acts as the public entrypoint in production.
- Automated linting and tests run through GitHub Actions. When contributing, ensure backend code passes `cargo fmt` and `cargo clippy`, and frontend code passes `npx eslint` and `npm run build`.

