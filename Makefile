.PHONY: help dev api web qg qg-go qg-ts fmt

# Default target prints help: tools that run a bare `make` (CI autobuilders)
# must never start the long-running dev servers.
help:
	@echo 'make dev | api | web | qg | qg-go | qg-ts | fmt'

dev: ## run API (:8080) and web (:5173) together
	@trap 'kill 0' INT; go run ./cmd/server & pnpm dev & wait

api:
	go run ./cmd/server

web:
	pnpm dev

qg: qg-go qg-ts ## full quality gate

qg-go:
	test -z "$$(gofmt -l .)" || (gofmt -l . && exit 1)
	go vet ./...
	golangci-lint run ./...
	go test ./...

qg-ts:
	pnpm fmt:check
	pnpm lint
	pnpm typecheck
	pnpm test
	pnpm build

fmt:
	gofmt -w .
	pnpm fmt
