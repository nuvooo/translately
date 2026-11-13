.PHONY: build up down logs shell-be shell-fe db-push seed test reset

# Build all services
build:
	docker compose build

# Start all services
up:
	docker compose up -d

# Stop all services
down:
	docker compose down

# View logs
logs:
	docker compose logs -f

# Backend shell
shell-be:
	docker compose exec backend sh

# Frontend shell
shell-fe:
	docker compose exec frontend sh

# Sync the schema (collections and indexes) in the running backend. MongoDB
# has no Prisma migrations; the backend also runs this on every start.
db-push:
	docker compose exec backend npx prisma db push --skip-generate

# Demo data, run from this machine against the MongoDB published by
# docker-compose.yml on 127.0.0.1:27017 (needs `npm install` in backend/).
# The runtime image has no seed script dependencies.
seed:
	cd backend && DATABASE_URL="mongodb://127.0.0.1:27017/translately?directConnection=true" npm run db:seed

# Run the tests on this machine (the runtime image has no dev dependencies)
test:
	cd backend && npm test
	cd frontend && npm test

# Reset everything (DANGER: removes all data!)
reset:
	docker compose down -v
	docker compose up -d --build
