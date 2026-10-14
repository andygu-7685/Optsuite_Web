# Sets up the Python venv + frontend deps and launches the dev servers.
#
#   make                 env + both dev servers
#   make backend         backend dev server only
#   make help

ifeq ($(OS),Windows_NT)
# Pin cmd.exe so recipes behave the same from PowerShell, cmd, and Git Bash.
SHELL := cmd.exe
.SHELLFLAGS := /c
PYTHON ?= py
VENV_PY := backend\.venv\Scripts\python.exe
RMDIR = if exist $(subst /,\,$(1)) rmdir /s /q $(subst /,\,$(1))
else
PYTHON ?= python3
VENV_PY := backend/.venv/bin/python
RMDIR = rm -rf $(1)
endif

WEB := frontend
VENV_DIR := backend/.venv
PY_STAMP := $(VENV_DIR)/.installed
NPM_STAMP := $(WEB)/node_modules/.package-lock.json

.DEFAULT_GOAL := all
.PHONY: all env backend frontend-dev dev build help clean

all: env dev

env: $(PY_STAMP) $(NPM_STAMP)

$(PY_STAMP): backend/requirements.txt
	$(PYTHON) -m venv $(VENV_DIR)
	$(VENV_PY) -m pip install --upgrade pip
	$(VENV_PY) -m pip install -r backend/requirements.txt
	$(VENV_PY) -c "import pathlib; pathlib.Path('$(PY_STAMP)').touch()"

# npm writes node_modules/.package-lock.json on every install.
$(NPM_STAMP): $(WEB)/package.json $(WEB)/package-lock.json
	cd $(WEB) && npm install

backend: $(PY_STAMP)
	$(VENV_PY) -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1

frontend-dev: $(NPM_STAMP)
	cd $(WEB) && npm run dev

dev: $(PY_STAMP) $(NPM_STAMP)
	$(MAKE) -j2 backend frontend-dev

build: $(NPM_STAMP)
	cd $(WEB) && npm run build

clean:
	$(call RMDIR,$(VENV_DIR))
	$(call RMDIR,$(WEB)/node_modules)

help:
	@echo make          - set up env, launch frontend and backend
	@echo make env      - create backend/.venv, pip install, npm install frontend
	@echo make backend  - launch the FastAPI backend only
	@echo make frontend-dev - launch the frontend only
	@echo make dev      - launch the frontend and backend dev servers
	@echo make build    - production build of frontend
	@echo make clean    - remove backend/.venv and node_modules
	@echo Vars: PYTHON=$(PYTHON)
