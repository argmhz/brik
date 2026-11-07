# Brik: genveje til de almindelige kommandoer. Kør `make` for at se dem.

PNPM    := corepack pnpm
DESKTOP := apps/desktop
TAURI   := $(DESKTOP)/src-tauri
# rustup lægger cargo i ~/.cargo/bin, som ikke altid er på PATH
export PATH := $(HOME)/.cargo/bin:$(PATH)

.DEFAULT_GOAL := help
.PHONY: help install editor demo mcp test test-watch typecheck check types player docs docs-screenshots \
        build desktop desktop-build desktop-deb clean clean-all

help: ## Viser denne hjælp
	@echo "Brik – brug: make <mål>"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN { FS = ":.*?## " } { printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }'

install: ## Installerer afhængigheder (pnpm install)
	$(PNPM) install

node_modules: package.json pnpm-lock.yaml
	$(PNPM) install
	@touch node_modules

editor: node_modules ## Starter editoren på http://localhost:5180
	$(PNPM) editor

demo: node_modules ## Starter sprites-demoen på http://localhost:5173
	$(PNPM) dev

mcp: node_modules ## Starter MCP-serveren alene (til fejlsøgning; AI-klienter starter den selv)
	node packages/mcp/src/server.mjs

test: node_modules ## Kører alle tests
	$(PNPM) test

test-watch: node_modules ## Kører tests igen, når filer ændres
	$(PNPM) test:watch

typecheck: node_modules ## Typechecker hele projektet
	$(PNPM) typecheck

check: typecheck test ## Typecheck og tests (før en commit)

types: node_modules ## Genererer typerne til scripts (brik.d.ts)
	$(PNPM) types

docs: node_modules ## Bygger dokumentationen (manual, guide, roadmap) til apps/web/public/docs
	$(PNPM) docs

docs-screenshots: node_modules ## Tager skærmbillederne til dokumentationen (kræver `make editor` og Chromium)
	$(PNPM) docs:screenshots

player: node_modules ## Bygger playeren (brik.js), som eksporterede spil bruger
	$(PNPM) player

build: node_modules ## Bygger web-editoren til apps/web/dist
	$(PNPM) build:editor

desktop: node_modules ## Starter desktop-appen (kræver Rust)
	cd $(DESKTOP) && $(PNPM) dev

desktop-build: node_modules ## Bygger desktop-appen og alle installere til dette system
	cd $(DESKTOP) && $(PNPM) build

desktop-deb: node_modules ## Bygger kun .deb-pakken (Linux)
	cd $(DESKTOP) && $(PNPM) tauri build --bundles deb
	@ls -1 $(TAURI)/target/release/bundle/deb/*.deb

clean: ## Sletter byggede filer (dist, genererede filer)
	rm -rf apps/web/dist examples/*/dist packages/editor/src/generated .types-out

clean-all: clean ## Som clean, plus node_modules og Rust-builds
	rm -rf node_modules apps/*/node_modules packages/*/node_modules examples/*/node_modules $(TAURI)/target
