# =============================================================================
# CarpeOS — Root Makefile
# =============================================================================
# Usage:
#   make worktree <name>        # Create a new worktree
#   make remove-worktree <name> # Remove a worktree and its branch
#   make list-worktrees         # List all worktrees
#   make status-worktree        # Show worktree status
#
#   make install                # pnpm install
#   make build / test / lint    # Common package scripts
#   make check                  # Full repo gate (pnpm check)
#   make help                   # Show this help
# =============================================================================

BLUE := \033[34m
GREEN := \033[32m
YELLOW := \033[33m
RED := \033[31m
CYAN := \033[36m
RESET := \033[0m

PROJECT_NAME := carpeos
CURRENT_DIR := $(shell pwd)
PARENT_DIR := $(shell dirname $(CURRENT_DIR))
PNPM ?= pnpm
BASE_REF ?= main

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show available commands
	@echo "$(BLUE)=== CarpeOS — Root Makefile ===$(RESET)"
	@echo "$(CYAN)Public monorepo for a personal knowledge operating system.$(RESET)"
	@echo ""
	@echo "$(GREEN)Git worktree:$(RESET)"
	@echo "  $(YELLOW)make worktree <name>$(RESET)          - Create worktree at ../$(PROJECT_NAME)-<name>"
	@echo "  $(YELLOW)make remove-worktree <name>$(RESET)   - Remove worktree and local worktree/<name> branch"
	@echo "  $(YELLOW)make list-worktrees$(RESET)           - List registered Git worktrees"
	@echo "  $(YELLOW)make status-worktree$(RESET)          - Show worktree + sibling directory status"
	@echo ""
	@echo "$(GREEN)Package scripts (pnpm):$(RESET)"
	@echo "  $(YELLOW)make install$(RESET)                  - pnpm install"
	@echo "  $(YELLOW)make build$(RESET)                    - pnpm build"
	@echo "  $(YELLOW)make test$(RESET)                     - pnpm test"
	@echo "  $(YELLOW)make lint$(RESET)                     - pnpm lint"
	@echo "  $(YELLOW)make typecheck$(RESET)                - pnpm typecheck"
	@echo "  $(YELLOW)make format$(RESET)                   - pnpm format"
	@echo "  $(YELLOW)make format-check$(RESET)             - pnpm format:check"
	@echo "  $(YELLOW)make public-boundary$(RESET)          - pnpm public-boundary"
	@echo "  $(YELLOW)make labels-check$(RESET)             - pnpm labels:check"
	@echo "  $(YELLOW)make check$(RESET)                    - Full gate (pnpm check)"
	@echo ""
	@echo "$(BLUE)Examples:$(RESET)"
	@echo "  make worktree pages            # ../$(PROJECT_NAME)-pages on worktree/pages"
	@echo "  make worktree cloudflare-ops   # ../$(PROJECT_NAME)-cloudflare-ops"
	@echo "  make remove-worktree pages"
	@echo ""
	@echo "$(BLUE)Notes:$(RESET)"
	@echo "  • New branches default to worktree/<name> from $(BASE_REF)"
	@echo "  • Override base with BASE_REF=origin/main if needed"
	@echo "  • Claude Code memory is symlinked from the main checkout when present"
	@echo ""

# =============================================================================
# Git worktree management
# =============================================================================

define create_worktree
	@echo "$(BLUE)Creating worktree: $(PROJECT_NAME)-$(1)$(RESET)"
	@if [ -z "$(1)" ]; then \
		echo "$(RED)Error: worktree name is required$(RESET)"; \
		echo "$(YELLOW)Usage: make worktree <name>$(RESET)"; \
		exit 1; \
	fi
	@if [ -d "$(PARENT_DIR)/$(PROJECT_NAME)-$(1)" ]; then \
		echo "$(RED)Error: $(PROJECT_NAME)-$(1) already exists$(RESET)"; \
		exit 1; \
	fi
	@if ! git rev-parse --verify --quiet "$(BASE_REF)" >/dev/null; then \
		echo "$(RED)Error: base ref '$(BASE_REF)' not found$(RESET)"; \
		exit 1; \
	fi
	@BRANCH_NAME="worktree/$(1)"; \
	echo "$(YELLOW)Branch: $$BRANCH_NAME (base $(BASE_REF))$(RESET)"; \
	if git show-ref --verify --quiet "refs/heads/$$BRANCH_NAME"; then \
		echo "$(YELLOW)Using existing branch $$BRANCH_NAME$(RESET)"; \
		git worktree add "$(PARENT_DIR)/$(PROJECT_NAME)-$(1)" "$$BRANCH_NAME"; \
	else \
		echo "$(YELLOW)Creating branch $$BRANCH_NAME from $(BASE_REF)$(RESET)"; \
		git worktree add -b "$$BRANCH_NAME" "$(PARENT_DIR)/$(PROJECT_NAME)-$(1)" "$(BASE_REF)"; \
	fi || { \
		echo "$(RED)Failed to create worktree$(RESET)"; \
		exit 1; \
	}
	@# Claude Code memory symlink (share with main checkout when present)
	@MAIN_ABS="$$(cd "$(CURRENT_DIR)" && pwd -P)"; \
	WT_ABS="$(PARENT_DIR)/$(PROJECT_NAME)-$(1)"; \
	MAIN_SLUG="$$(printf '%s' "$$MAIN_ABS" | sed 's|^/||; s|/|-|g; s|^|-|')"; \
	WT_SLUG="$$(printf '%s' "$$WT_ABS" | sed 's|^/||; s|/|-|g; s|^|-|')"; \
	MAIN_MEMORY="$(HOME)/.claude/projects/$$MAIN_SLUG/memory"; \
	WT_PROJECT_DIR="$(HOME)/.claude/projects/$$WT_SLUG"; \
	if [ -d "$$MAIN_MEMORY" ]; then \
		mkdir -p "$$WT_PROJECT_DIR"; \
		if [ -d "$$WT_PROJECT_DIR/memory" ] && [ ! -L "$$WT_PROJECT_DIR/memory" ]; then \
			rm -rf "$$WT_PROJECT_DIR/memory"; \
		fi; \
		if [ ! -e "$$WT_PROJECT_DIR/memory" ]; then \
			ln -s "$$MAIN_MEMORY" "$$WT_PROJECT_DIR/memory"; \
			echo "$(GREEN)Claude Code memory linked to main checkout$(RESET)"; \
		fi; \
	fi
	@echo "$(GREEN)Worktree created: $(PARENT_DIR)/$(PROJECT_NAME)-$(1)$(RESET)"
	@echo "$(GREEN)Branch: worktree/$(1)$(RESET)"
	@echo "$(BLUE)Next: cd $(PARENT_DIR)/$(PROJECT_NAME)-$(1) && make install$(RESET)"
endef

.PHONY: worktree
worktree: ## Create a worktree (usage: make worktree <name>)
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "$(RED)Error: worktree name is required$(RESET)"; \
		echo "$(YELLOW)Usage: make worktree <name>$(RESET)"; \
		echo "$(YELLOW)Example: make worktree pages$(RESET)"; \
		exit 1; \
	fi
	@if [ "$(words $(filter-out $@,$(MAKECMDGOALS)))" -gt 1 ]; then \
		echo "$(RED)Error: pass exactly one worktree name$(RESET)"; \
		exit 1; \
	fi
	@$(call create_worktree,$(filter-out $@,$(MAKECMDGOALS)))

.PHONY: remove-worktree
remove-worktree: ## Remove a worktree (usage: make remove-worktree <name>)
	@if [ -z "$(filter-out $@,$(MAKECMDGOALS))" ]; then \
		echo "$(RED)Error: worktree name is required$(RESET)"; \
		echo "$(YELLOW)Usage: make remove-worktree <name>$(RESET)"; \
		exit 1; \
	fi
	@if [ "$(words $(filter-out $@,$(MAKECMDGOALS)))" -gt 1 ]; then \
		echo "$(RED)Error: pass exactly one worktree name$(RESET)"; \
		exit 1; \
	fi
	@WT_NAME="$(filter-out $@,$(MAKECMDGOALS))"; \
	BRANCH_NAME="worktree/$$WT_NAME"; \
	WT_PATH="$(PARENT_DIR)/$(PROJECT_NAME)-$$WT_NAME"; \
	echo "$(BLUE)Removing worktree: $(PROJECT_NAME)-$$WT_NAME$(RESET)"; \
	if [ -d "$$WT_PATH" ]; then \
		git worktree remove "$$WT_PATH" --force && \
		echo "$(YELLOW)Also removing branch: $$BRANCH_NAME$(RESET)" && \
		git branch -D "$$BRANCH_NAME" 2>/dev/null || true && \
		echo "$(GREEN)Removed $(PROJECT_NAME)-$$WT_NAME$(RESET)"; \
	else \
		echo "$(RED)Worktree not found: $(PROJECT_NAME)-$$WT_NAME$(RESET)"; \
		echo "$(YELLOW)Registered worktrees:$(RESET)"; \
		git worktree list; \
		exit 1; \
	fi

.PHONY: list-worktrees
list-worktrees: ## List all worktrees
	@echo "$(BLUE)Git worktrees:$(RESET)"
	@git worktree list -v || echo "$(RED)No worktrees found$(RESET)"
	@echo ""
	@echo "$(BLUE)Sibling directories ($(PROJECT_NAME)-*):$(RESET)"
	@ls -1d "$(PARENT_DIR)"/$(PROJECT_NAME)-* 2>/dev/null || echo "$(YELLOW)None$(RESET)"

.PHONY: status-worktree
status-worktree: ## Show worktree status
	@echo "$(BLUE)Worktree status$(RESET)"
	@echo "$(BLUE)===============$(RESET)"
	@echo ""
	@echo "$(GREEN)Current:$(RESET) $(CURRENT_DIR)"
	@echo "$(GREEN)Parent:$(RESET)  $(PARENT_DIR)"
	@echo "$(GREEN)Branch:$(RESET)  $$(git branch --show-current 2>/dev/null || echo detached)"
	@echo "$(GREEN)Base:$(RESET)    $(BASE_REF)"
	@echo ""
	@echo "$(GREEN)Git worktrees:$(RESET)"
	@git worktree list -v
	@echo ""
	@echo "$(GREEN)Sibling directories:$(RESET)"
	@ls -la "$(PARENT_DIR)" | grep "$(PROJECT_NAME)" | head -30 || true
	@echo ""
	@echo "$(BLUE)Branch roles:$(RESET)"
	@echo "  • main              → stable integration branch"
	@echo "  • worktree/<name>   → dedicated branch for ../$(PROJECT_NAME)-<name>"
	@echo "  • feat/* docs/* …   → topic branches (may also be checked out as worktrees)"

# =============================================================================
# Package scripts
# =============================================================================

.PHONY: install build test lint typecheck format format-check
.PHONY: public-boundary labels-check check

install: ## Install dependencies (pnpm install)
	@$(PNPM) install

build: ## Build all packages
	@$(PNPM) build

test: ## Run package tests
	@$(PNPM) test

lint: ## Run Biome lint
	@$(PNPM) lint

typecheck: ## Run TypeScript typecheck
	@$(PNPM) typecheck

format: ## Format with Biome
	@$(PNPM) format

format-check: ## Check formatting
	@$(PNPM) format:check

public-boundary: ## Public boundary scanner
	@$(PNPM) public-boundary

labels-check: ## Label catalog / PR label checks
	@$(PNPM) labels:check

check: ## Full repository gate
	@$(PNPM) check

# Treat positional worktree names as arguments, not unknown targets.
%:
	@:
