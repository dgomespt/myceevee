.DEFAULT_GOAL := help
.PHONY: help setup env dev lint lock npm test check build start docker-build docker-up docker-down docker-logs clean clear-cache

PORT ?= 4321
IMAGE ?= myceevee

# Everything that needs Node or npm runs inside a container, so the host only needs `make` and Docker.
# The image matches CI. The container runs as you (so node_modules, .astro and the lockfile are yours, not root's)
# and keeps npm's download cache in ./.npm-cache (git-ignored) so repeat runs are fast.
# --ignore-scripts: better-sqlite3 ships prebuilt binaries, so no native compile step is needed.
NODE_IMAGE ?= node:24
DOCKER_NODE := docker run --rm --init --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/app/.npm-cache \
	-e npm_config_ignore_scripts=true -v "$(CURDIR):/app" -w /app
# Interactive flags only when run from a terminal, so these targets also work from scripts.
TTY := $(shell [ -t 0 ] && echo -it)
NODE := $(DOCKER_NODE) $(NODE_IMAGE)
# For servers: also publish the port. (The app reads process.env, which `astro dev` doesn't fill from .env on its
# own, so Node loads .env with --env-file.)
NODE_SERVE := $(DOCKER_NODE) $(TTY) -p $(PORT):4321 $(NODE_IMAGE) node --env-file=.env

help: ## Show this help
	@echo "myceevee: run 'make <target>'"; echo
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: env node_modules ## First-time setup: install deps (in Docker) and create .env with fresh secrets
	@echo; echo "Done. Next: put your gist id in .env (GIST_ID=...), then run 'make dev'."

env: ## Create .env from .env.example (only if missing) with random secrets
	@if [ -f .env ]; then echo ".env already exists, leaving it alone"; else \
	  cp .env.example .env; \
	  sed -i "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$$(openssl rand -hex 16)|; s|^SESSION_SECRET=.*|SESSION_SECRET=$$(openssl rand -base64 32)|" .env; \
	  echo "Created .env. Your admin login token is the ADMIN_TOKEN line in it."; fi

node_modules: package.json package-lock.json
	$(NODE) npm ci
	@touch node_modules

dev: .env node_modules ## Dev server with live reload, in Docker (port 4321, or PORT=4400 make dev)
	$(NODE_SERVE) node_modules/.bin/astro dev --host 0.0.0.0 --port 4321

lint: node_modules ## Lint with ESLint (CI runs this too)
	$(NODE) npm run lint

check: node_modules ## Type-check the project
	$(NODE) npm run check

test: node_modules ## Run the unit tests
	$(NODE) npm test

build: node_modules ## Build the production server
	$(NODE) npm run build

start: .env build ## Build, then run the production server in Docker (port 4321, or PORT=4400 make start)
	$(NODE_SERVE) dist/server/entry.mjs

lock: ## Regenerate package-lock.json in Docker with CI's npm (run after changing dependencies)
	$(NODE) npm install --package-lock-only

npm: ## Run any npm command in Docker: make npm ARGS="install -D some-package"
	$(NODE) npm $(ARGS)

docker-build: ## Build the Docker image: make docker-build TAG=1.0.0  (IMAGE=name to rename, default myceevee)
	@if [ -z "$(TAG)" ]; then echo "Usage: make docker-build TAG=<tag>   e.g. make docker-build TAG=1.0.0" >&2; exit 2; fi
	@if ! echo "$(TAG)" | grep -qE '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$$'; then echo "Invalid tag \"$(TAG)\": use letters, digits, '_', '.' or '-' (max 128, not starting with '.' or '-')." >&2; exit 2; fi
	docker build -t $(IMAGE):$(TAG) .
	@echo "Built $(IMAGE):$(TAG)"

docker-up: .env ## Build and start the app with Docker Compose (state is kept in ./data)
	docker compose up -d --build
	@echo "Running on http://localhost:$${HOST_PORT:-4321}"

docker-down: ## Stop the Docker Compose container
	docker compose down

docker-logs: ## Follow the Docker Compose logs
	docker compose logs -f

clean: ## Remove build output (keeps node_modules, .npm-cache, .env and ./data)
	rm -rf dist .astro

clear-cache: ## Clear the running server's gist + CV photo caches, so CVs rebuild from the gist (PORT=... if not 4321)
	@./scripts/refresh-server-cache.sh "$${URL:-http://localhost:$(PORT)}"

.env:
	@$(MAKE) --no-print-directory env
