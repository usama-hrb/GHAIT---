# Everyday commands. `make help` lists them.
# Docker targets use STACK=dev (default) or STACK=prod, e.g. `make up STACK=prod`.
.DEFAULT_GOAL := help

# The stack comes from the command line, the environment, or a STACK=prod line in .env, so a
# server whose .env says STACK=prod runs production with a plain `make up`. Without any of those
# it is dev.
STACK ?= $(or $(shell sed -n 's/^STACK=//p' .env 2>/dev/null | tail -n 1),dev)
COMPOSE := docker compose --env-file .env -f infra/docker/compose.$(STACK).yml
# Extra compose profiles, e.g. `make up PROFILES=tools` for pgAdmin.
PROFILES ?=
COMPOSE_PROFILES_ARG := $(foreach p,$(PROFILES),--profile $(p))

.PHONY: help install dev up down logs ps build images lint typecheck test check deps \
	migrate migrate-new shop-adopt shop-new shop-list shop-suspend shop-resume shop-code shop-host shop-close owner partner-user cashier-user e2e e2e-shops backup backup-verify restore export import clean format format-check

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

migrate: .env ## Apply pending migrations in the running api container (STACK=dev|prod); with MULTI_SHOP=true name the shop: SHOP=<slug>|all
	$(COMPOSE) exec api node dist/migrate.js $(if $(SHOP),--shop "$(SHOP)")

migrate-new: ## Generate a migration from the schema: NAME=<name> [CUSTOM=1 for hand-written SQL] [CONTROL=1 for the control database]
	@test -n "$(NAME)" || { echo "usage: make migrate-new NAME=<name> [CUSTOM=1] [CONTROL=1]" >&2; exit 1; }
	pnpm --filter @fabric/api exec drizzle-kit generate --name $(NAME) $(if $(CUSTOM),--custom) $(if $(CONTROL),--config drizzle-control.config.ts)

# Adopts the live shop (the database in DATABASE_URL) as the first shop of a multi-shop server. It
# works with MULTI_SHOP=false: run it before the flag is turned on (docs/runbooks/api.md).
shop-adopt: .env ## Adopt the live shop as shop 1 of a multi-shop server: SLUG=<name> HOST=<address devices use today>
	@test -n "$(SLUG)" -a -n "$(HOST)" || { echo 'usage: make shop-adopt SLUG=<name> HOST=<address devices use today>' >&2; exit 1; }
	$(COMPOSE) exec -T api node dist/shop-adopt.js --slug "$(SLUG)" --host "$(HOST)" --actor "$$(id -un)"

# The shop commands of the operator (ADR 0029, Step 5). There is no web page or API route for
# them: only whoever runs the server can make, suspend or close a shop. Like shop-adopt they work
# with MULTI_SHOP=false, and they need SETUP_CODE_SECRET only where a setup code is made.
# Without HOST=, the shop's address is <slug>.<PLATFORM_DOMAIN> (from .env, ADR 0029). A host name
# has no underscore, so an underscore in the slug becomes a hyphen. With no PLATFORM_DOMAIN either,
# the shop has no address yet.
PLATFORM_DOMAIN ?= $(shell sed -n 's/^PLATFORM_DOMAIN=//p' .env 2>/dev/null | tail -n 1)
NEW_SHOP_HOST = $(or $(HOST),$(if $(PLATFORM_DOMAIN),$(subst _,-,$(SLUG)).$(PLATFORM_DOMAIN)))

shop-new: .env ## Make a shop and its setup code (shown once): SLUG=<name> [HOST=<address>] [LABEL="<note>"]
	@test -n "$(SLUG)" || { echo 'usage: make shop-new SLUG=<name> [HOST=<address>] [LABEL="<note>"]' >&2; exit 1; }
	$(COMPOSE) exec -T api node dist/shop.js new --slug "$(SLUG)" $(if $(NEW_SHOP_HOST),--host "$(NEW_SHOP_HOST)") $(if $(LABEL),--label "$(LABEL)") --actor "$$(id -un)"

shop-list: .env ## List the shops: state, addresses, schema, owner, setup code
	$(COMPOSE) exec -T api node dist/shop.js list --actor "$$(id -un)"

shop-suspend: .env ## Refuse a shop until it is resumed (its tablets keep selling offline): SLUG=<name> REASON="<why>"
	@test -n "$(SLUG)" -a -n "$(REASON)" || { echo 'usage: make shop-suspend SLUG=<name> REASON="<why>"' >&2; exit 1; }
	$(COMPOSE) exec -T api node dist/shop.js suspend --slug "$(SLUG)" --reason "$(REASON)" --actor "$$(id -un)"

shop-resume: .env ## Serve a suspended shop again: SLUG=<name>
	@test -n "$(SLUG)" || { echo 'usage: make shop-resume SLUG=<name>' >&2; exit 1; }
	$(COMPOSE) exec -T api node dist/shop.js resume --slug "$(SLUG)" --actor "$$(id -un)"

shop-code: .env ## A new setup code for a shop that has no owner yet (the old one stops working): SLUG=<name>
	@test -n "$(SLUG)" || { echo 'usage: make shop-code SLUG=<name>' >&2; exit 1; }
	$(COMPOSE) exec -T api node dist/shop.js code --slug "$(SLUG)" --actor "$$(id -un)"

shop-host: .env ## One more address for a shop: SLUG=<name> HOST=<address>
	@test -n "$(SLUG)" -a -n "$(HOST)" || { echo 'usage: make shop-host SLUG=<name> HOST=<address>' >&2; exit 1; }
	$(COMPOSE) exec -T api node dist/shop.js host --slug "$(SLUG)" --host "$(HOST)" --actor "$$(id -un)"

shop-close: .env ## End a shop for good; the data stays, nothing is dropped: SLUG=<name> REASON="<why>" CONFIRM=<name>
	@test -n "$(SLUG)" -a -n "$(REASON)" -a -n "$(CONFIRM)" || { echo 'usage: make shop-close SLUG=<name> REASON="<why>" CONFIRM=<name again>' >&2; exit 1; }
	$(COMPOSE) exec -T api node dist/shop.js close --slug "$(SLUG)" --reason "$(REASON)" --confirm "$(CONFIRM)" --actor "$$(id -un)"

# The password is read without echo and piped on stdin: never in argv or the shell history.
owner: .env ## Create the owner account or reset its password: USERNAME=<name> [NAME="<display name>"] [SHOP=<slug> with MULTI_SHOP]
	@test -n "$(USERNAME)" || { echo 'usage: make owner USERNAME=<name> [NAME="<display name>"]' >&2; exit 1; }
	@printf 'Password for %s (12+ characters): ' "$(USERNAME)"; \
	stty -echo 2>/dev/null; read -r pw; stty echo 2>/dev/null; echo; \
	printf '%s' "$$pw" | $(COMPOSE) exec -T api node dist/create-owner.js \
		--username "$(USERNAME)" $(if $(NAME),--name "$(NAME)") $(if $(SHOP),--shop "$(SHOP)")

partner-user: .env ## Give an existing partner a read-only login or reset its password: USERNAME=<name> PARTNER=<partner name or id> [NAME="…"] [SHOP=<slug>]
	@test -n "$(USERNAME)" -a -n "$(PARTNER)" || { echo 'usage: make partner-user USERNAME=<name> PARTNER=<partner name or id> [NAME="<display name>"]' >&2; exit 1; }
	@printf 'Password for %s (12+ characters): ' "$(USERNAME)"; \
	stty -echo 2>/dev/null; read -r pw; stty echo 2>/dev/null; echo; \
	printf '%s' "$$pw" | $(COMPOSE) exec -T api node dist/create-partner-user.js \
		--username "$(USERNAME)" --partner "$(PARTNER)" $(if $(NAME),--name "$(NAME)") $(if $(SHOP),--shop "$(SHOP)")

cashier-user: .env ## Create a cashier account (sells, sees no cost or profit) or reset its password: USERNAME=<name> [NAME="…"] [SHOP=<slug>]
	@test -n "$(USERNAME)" || { echo 'usage: make cashier-user USERNAME=<name> [NAME="<display name>"]' >&2; exit 1; }
	@printf 'Password for %s (12+ characters): ' "$(USERNAME)"; \
	stty -echo 2>/dev/null; read -r pw; stty echo 2>/dev/null; echo; \
	printf '%s' "$$pw" | $(COMPOSE) exec -T api node dist/create-cashier-user.js \
		--username "$(USERNAME)" $(if $(NAME),--name "$(NAME)") $(if $(SHOP),--shop "$(SHOP)")

# With MULTI_SHOP=true, SHOP=<slug> names the shop (SHOP=control: the control database). It reaches the
# scripts below as an environment variable, because make exports what is on its command line.
backup: .env ## Dump the DB to BACKUP_DIR, keep the newest BACKUP_KEEP (STACK=dev|prod); MULTI_SHOP: every shop and the control DB, or SHOP=<slug>|control
	STACK=$(STACK) infra/scripts/backup.sh

backup-verify: .env ## Fresh dump → restore into a scratch DB → compare row counts (MULTI_SHOP: each shop, or SHOP=<slug>|control)
	STACK=$(STACK) infra/scripts/verify-backup.sh

restore: .env ## Restore FILE=<dump> into the app DB (MULTI_SHOP: SHOP=<slug>|control), or into DB=<name> (scratch copy)
	@test -n "$(FILE)" || { echo "usage: make restore FILE=backups/<file>.dump [DB=<name>]" >&2; exit 1; }
	STACK=$(STACK) infra/scripts/restore.sh "$(FILE)" $(DB)

export: .env ## Write the shop's data as JSON to FILE (default backups/export_<UTC time>.json; MULTI_SHOP: SHOP=<slug>, backups/<slug>/…)
	@out="$(or $(FILE),backups/$(if $(SHOP),$(SHOP)/)export_$$(date -u +%Y%m%dT%H%M%SZ).json)"; \
	mkdir -p "$$(dirname "$$out")" && \
	$(COMPOSE) exec -T api node dist/data-export.js $(if $(SHOP),--shop "$(SHOP)") > "$$out" && echo "$$out"

import: .env ## Load an export (server's or a device's) FILE=<json> into an EMPTY database (MULTI_SHOP: SHOP=<slug>)
	@test -n "$(FILE)" || { echo "usage: make import FILE=<export.json> [SHOP=<slug>]" >&2; exit 1; }
	$(COMPOSE) exec -T api node dist/data-import.js $(if $(SHOP),--shop "$(SHOP)") < "$(FILE)"

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

e2e-shops: ## The same browser tests on a server with many shops (the shop adopted, more shops made; ADR 0029); needs Docker
	pnpm turbo run build --filter=@fabric/api
	pnpm --filter @fabric/web exec playwright install chromium
	pnpm --filter @fabric/web test:e2e:adopted

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
