# Sets up the Python venv + frontend deps, exports the YOLO model to ONNX,
# and launches the frontend dev server.
#
#   make                 env + export (if the .pt is newer) + dev server
#   make export MODEL=usaf_registration/models/best_4p_1.pt
#   make help

ifeq ($(OS),Windows_NT)
# Pin cmd.exe so recipes behave the same from PowerShell, cmd, and Git Bash.
SHELL := cmd.exe
.SHELLFLAGS := /c
PYTHON ?= py
VENV_PY := .venv\Scripts\python.exe
RMDIR = if exist $(subst /,\,$(1)) rmdir /s /q $(subst /,\,$(1))
else
PYTHON ?= python3
VENV_PY := .venv/bin/python
RMDIR = rm -rf $(1)
endif

WEB := frontend
MODEL ?= usaf_registration/models/4p_detect_ultra_pro_max.pt
# Extra export_model.py flags, e.g. EXPORT_ARGS="--imgsz 960 --no-simplify"
EXPORT_ARGS ?=

ONNX := $(WEB)/public/models/$(basename $(notdir $(MODEL))).onnx
PY_STAMP := .venv/.installed
NPM_STAMP := $(WEB)/node_modules/.package-lock.json

.DEFAULT_GOAL := all
.PHONY: all env export model dev build help clean

all: env model dev

env: $(PY_STAMP) $(NPM_STAMP)

$(PY_STAMP): requirements.txt
	$(PYTHON) -m venv .venv
	$(VENV_PY) -m pip install --upgrade pip
	$(VENV_PY) -m pip install -r requirements.txt
	$(VENV_PY) -c "import pathlib; pathlib.Path('$(PY_STAMP)').touch()"

# npm writes node_modules/.package-lock.json on every install; postinstall
# copies the onnxruntime-web runtime into public/ort/.
$(NPM_STAMP): $(WEB)/package.json $(WEB)/package-lock.json
	cd $(WEB) && npm install

# Re-export only when the checkpoint is newer than the committed .onnx.
model: $(ONNX)

$(ONNX): $(MODEL) | $(PY_STAMP)
	$(VENV_PY) usaf_registration/export_model.py --model $(MODEL) $(EXPORT_ARGS)

# Always re-export, regardless of timestamps.
export: | $(PY_STAMP)
	$(VENV_PY) usaf_registration/export_model.py --model $(MODEL) $(EXPORT_ARGS)

dev: $(NPM_STAMP)
	cd $(WEB) && npm run dev

build: $(NPM_STAMP)
	cd $(WEB) && npm run build

clean:
	$(call RMDIR,.venv)
	$(call RMDIR,$(WEB)/node_modules)
	$(call RMDIR,$(WEB)/public/ort)

help:
	@echo make          - set up env, export model if stale, launch frontend
	@echo make env      - create .venv, pip install, npm install frontend
	@echo make model    - export MODEL to ONNX only if the .pt is newer
	@echo make export   - always re-export MODEL (default $(MODEL))
	@echo make dev      - launch the frontend dev server
	@echo make build    - production build of frontend
	@echo make clean    - remove .venv, node_modules, public/ort
	@echo Vars: PYTHON=$(PYTHON) MODEL=path/to.pt EXPORT_ARGS="--imgsz 960"
