# Everyday commands. `make help` lists them.
# Docker targets use STACK=dev (default) or STACK=prod, e.g. `make up STACK=prod`.
.DEFAULT_GOAL := help

STACK ?= dev
COMPOSE := docker compose --env-file .env -f infra/docker/compose.$(STACK).yml
# Extra compose profiles, e.g. `make up PROFILES=tools` for pgAdmin.
PROFILES ?=
COMPOSE_PROFILES_ARG := $(foreach p,$(PROFILES),--profile $(p))

.PHONY: help install dev up down logs ps build images lint typecheck test check deps \
	migrate migrate-new owner partner-user cashier-user e2e backup backup-verify restore export import clean format format-check

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.env:
	cp .env.example .env
	@echo "Created .env from .env.example. Review it (passwords!) before using STACK=prod."

## ── Docker stack ───────────────────────────────────────────────────────────

up: .env ## Start the stack (STACK=dev|prod, PROFILES=tools) and wait until healthy
	$(COMPOSE) $(COMPOSE_PROFILES_ARG) up -d --build --wait

down: .env ## Stop the stack (data volumes are kept)
	$(COMPOSE) $(COMPOSE_PROFILES_ARG) down

logs: .env ## Follow logs (SERVICE=api to filter)
	$(COMPOSE) logs -f --tail=100 $(SERVICE)

ps: .env ## Show stack containers and health
	$(COMPOSE) ps

images: .env ## Build the production Docker images
	docker compose --env-file .env -f infra/docker/compose.prod.yml build

## ── Database ───────────────────────────────────────────────────────────────

migrate: .env ## Apply pending migrations in the running api container (STACK=dev|prod)
	$(COMPOSE) exec api node dist/migrate.js

migrate-new: ## Generate a migration from the schema: NAME=<name> [CUSTOM=1 for hand-written SQL]
	@test -n "$(NAME)" || { echo "usage: make migrate-new NAME=<name> [CUSTOM=1]" >&2; exit 1; }
	pnpm --filter @fabric/api exec drizzle-kit generate --name $(NAME) $(if $(CUSTOM),--custom)

# The password is read without echo and piped on stdin: never in argv or the shell history.
owner: .env ## Create the owner account or reset its password: USERNAME=<name> [NAME="<display name>"]
	@test -n "$(USERNAME)" || { echo 'usage: make owner USERNAME=<name> [NAME="<display name>"]' >&2; exit 1; }
	@printf 'Password for %s (12+ characters): ' "$(USERNAME)"; \
	stty -echo 2>/dev/null; read -r pw; stty echo 2>/dev/null; echo; \
	printf '%s' "$$pw" | $(COMPOSE) exec -T api node dist/create-owner.js \
		--username "$(USERNAME)" $(if $(NAME),--name "$(NAME)")

partner-user: .env ## Create the partner's read-only account or reset its password: USERNAME=<name> [NAME="…"]
	@test -n "$(USERNAME)" || { echo 'usage: make partner-user USERNAME=<name> [NAME="<display name>"]' >&2; exit 1; }
	@printf 'Password for %s (12+ characters): ' "$(USERNAME)"; \
	stty -echo 2>/dev/null; read -r pw; stty echo 2>/dev/null; echo; \
	printf '%s' "$$pw" | $(COMPOSE) exec -T api node dist/create-partner-user.js \
		--username "$(USERNAME)" $(if $(NAME),--name "$(NAME)")

cashier-user: .env ## Create a cashier account (sells, sees no cost or profit) or reset its password: USERNAME=<name> [NAME="…"]
	@test -n "$(USERNAME)" || { echo 'usage: make cashier-user USERNAME=<name> [NAME="<display name>"]' >&2; exit 1; }
	@printf 'Password for %s (12+ characters): ' "$(USERNAME)"; \
	stty -echo 2>/dev/null; read -r pw; stty echo 2>/dev/null; echo; \
	printf '%s' "$$pw" | $(COMPOSE) exec -T api node dist/create-cashier-user.js \
		--username "$(USERNAME)" $(if $(NAME),--name "$(NAME)")

backup: .env ## Dump the DB to BACKUP_DIR, keep the newest BACKUP_KEEP (STACK=dev|prod)
	STACK=$(STACK) infra/scripts/backup.sh

backup-verify: .env ## Fresh dump → restore into a scratch DB → compare row counts
	STACK=$(STACK) infra/scripts/verify-backup.sh

restore: .env ## Restore FILE=<dump> into the app DB, or into DB=<name> (scratch copy)
	@test -n "$(FILE)" || { echo "usage: make restore FILE=backups/<file>.dump [DB=<name>]" >&2; exit 1; }
	STACK=$(STACK) infra/scripts/restore.sh "$(FILE)" $(DB)

export: .env ## Write the shop's data as JSON to FILE (default backups/export_<UTC time>.json)
	@mkdir -p backups
	@out="$(or $(FILE),backups/export_$$(date -u +%Y%m%dT%H%M%SZ).json)"; \
	$(COMPOSE) exec -T api node dist/data-export.js > "$$out" && echo "$$out"

import: .env ## Load an export (server's or a device's) FILE=<json> into an EMPTY database
	@test -n "$(FILE)" || { echo "usage: make import FILE=<export.json>" >&2; exit 1; }
	$(COMPOSE) exec -T api node dist/data-import.js < "$(FILE)"

## ── Code ───────────────────────────────────────────────────────────────────

install: ## Install dependencies (frozen lockfile)
	pnpm install --frozen-lockfile

dev: ## Run all apps on the host in watch mode (Postgres via `make up`)
	pnpm turbo run dev

build: ## Build every package and app
	pnpm turbo run build

lint: ## ESLint (includes import-boundary rules)
	pnpm turbo run lint

typecheck: ## TypeScript, no emit
	pnpm turbo run typecheck

test: ## Run all tests
	pnpm turbo run test

check: ## Lint + typecheck + tests (definition of done)
	pnpm turbo run lint typecheck test

e2e: ## Browser tests on the real stack (Postgres container, API, web build; needs Docker)
	pnpm turbo run build --filter=@fabric/api
	pnpm --filter @fabric/web exec playwright install chromium
	pnpm --filter @fabric/web test:e2e

deps: ## Validate dependency directions with dependency-cruiser
	pnpm turbo run build --filter='./packages/*'
	pnpm depcruise apps packages

format: ## Format all files with Prettier
	pnpm prettier --write .

format-check: ## Check formatting
	pnpm prettier --check .

clean: ## Remove build outputs and caches (keeps node_modules, .env and Docker volumes)
	rm -rf .turbo apps/*/dist apps/*/.next apps/*/.turbo apps/*/coverage \
		packages/*/dist packages/*/.turbo packages/*/coverage apps/web/next-env.d.ts \
		apps/web/tsconfig.tsbuildinfo
