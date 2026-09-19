.PHONY: help up down logs test build migrate seed clean prod prod-logs

MVN := cd backend-java && ./mvnw
COMPOSE_PROD := docker compose -f docker-compose.yml -f docker-compose.prod.yml

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  %-12s %s\n", $$1, $$2}'

up: ## Build and start the full stack (app + postgres) on :8080
	docker compose up -d --build

down: ## Stop the stack (keeps the database volume)
	docker compose down

logs: ## Follow the application log
	docker compose logs -f app

build: ## Build the WAR with the UI bundled in (no Docker)
	$(MVN) -B package

test: ## Full test suite — unit plus Testcontainers integration (needs Docker)
	$(MVN) -B test

migrate: ## Apply db/migrate.js to the running database
	docker compose run --rm migrate

seed: ## Load the demo gym: 120 members, 4 trainers, every module populated
	docker compose run --rm migrate sh -c "node seed-demo.js"

prod: ## Start the production stack with HTTPS (reads .env)
	$(COMPOSE_PROD) up -d --build app caddy

prod-logs: ## Follow the production application and proxy logs
	$(COMPOSE_PROD) logs -f app caddy

clean: ## Stop the stack and delete its data volume
	docker compose down -v
