.DEFAULT_GOAL := help
.PHONY: help setup env dev test check build start docker-build docker-up docker-down docker-logs clean clear-cache

PORT ?= 4321
IMAGE ?= myceevee
# Node loads .env for us (the app reads process.env, which `astro dev` doesn't populate from .env on its own).
NODE_ENV_FILE := node --env-file=.env

help: ## Show this help
	@echo "myceevee: run 'make <target>'"; echo
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: env node_modules ## First-time setup: install deps and create .env with fresh secrets
	@echo; echo "Done. Next: put your gist id in .env (GIST_ID=...), then run 'make dev'."

env: ## Create .env from .env.example (only if missing) with random secrets
	@if [ -f .env ]; then echo ".env already exists, leaving it alone"; else \
	  cp .env.example .env; \
	  sed -i "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$$(openssl rand -hex 16)|; s|^SESSION_SECRET=.*|SESSION_SECRET=$$(openssl rand -base64 32)|" .env; \
	  echo "Created .env. Your admin login token is the ADMIN_TOKEN line in it."; fi

node_modules: package.json package-lock.json
	npm install
	@touch node_modules

dev: .env node_modules ## Start the dev server with live reload (port 4321, or PORT=4400 make dev)
	$(NODE_ENV_FILE) node_modules/.bin/astro dev --port $(PORT)

test: node_modules ## Run the unit tests
	npm test

check: node_modules ## Type-check the project
	npm run check

build: node_modules ## Build the production server
	npm run build

start: .env build ## Build and run the production server locally
	$(NODE_ENV_FILE) node dist/server/entry.mjs

docker-build: ## Build the Docker image: make docker-build TAG=1.0.0  (IMAGE=name to rename, default myceevee)
	@if [ -z "$(TAG)" ]; then echo "Usage: make docker-build TAG=<tag>   e.g. make docker-build TAG=1.0.0" >&2; exit 2; fi
	@if ! echo "$(TAG)" | grep -qE '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$$'; then echo "Invalid tag \"$(TAG)\": use letters, digits, '_', '.' or '-' (max 128, not starting with '.' or '-')." >&2; exit 2; fi
	docker build -t $(IMAGE):$(TAG) .
	@echo "Built $(IMAGE):$(TAG)"

docker-up: .env ## Build and start in Docker (state is kept in ./data)
	docker compose up -d --build
	@echo "Running on http://localhost:$${HOST_PORT:-4321}"

docker-down: ## Stop the Docker container
	docker compose down

docker-logs: ## Follow the Docker logs
	docker compose logs -f

clean: ## Remove build output (keeps node_modules, .env and ./data)
	rm -rf dist .astro

clear-cache: ## Clear the running server's gist + CV photo caches, so CVs rebuild from the gist (PORT=... if not 4321)
	@./scripts/refresh-server-cache.sh "$${URL:-http://localhost:$(PORT)}"

.env:
	@$(MAKE) --no-print-directory env
