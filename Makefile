# Sets up the Python venv + microscopy-poc deps, exports the YOLO model to ONNX,
# and launches the microscopy-poc dev server.
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

POC := microscopy-poc
MODEL ?= usaf_registration/models/4p_detect_ultra_pro_max.pt
# Extra export_model.py flags, e.g. EXPORT_ARGS="--imgsz 960 --no-simplify"
EXPORT_ARGS ?=

ONNX := $(POC)/public/models/$(basename $(notdir $(MODEL))).onnx
PY_STAMP := .venv/.installed
NPM_STAMP := $(POC)/node_modules/.package-lock.json

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
$(NPM_STAMP): $(POC)/package.json $(POC)/package-lock.json
	cd $(POC) && npm install

# Re-export only when the checkpoint is newer than the committed .onnx.
model: $(ONNX)

$(ONNX): $(MODEL) | $(PY_STAMP)
	$(VENV_PY) usaf_registration/export_model.py --model $(MODEL) $(EXPORT_ARGS)

# Always re-export, regardless of timestamps.
export: | $(PY_STAMP)
	$(VENV_PY) usaf_registration/export_model.py --model $(MODEL) $(EXPORT_ARGS)

dev: $(NPM_STAMP)
	cd $(POC) && npm run dev

build: $(NPM_STAMP)
	cd $(POC) && npm run build

clean:
	$(call RMDIR,.venv)
	$(call RMDIR,$(POC)/node_modules)
	$(call RMDIR,$(POC)/public/ort)

help:
	@echo make          - set up env, export model if stale, launch microscopy-poc
	@echo make env      - create .venv, pip install, npm install microscopy-poc
	@echo make model    - export MODEL to ONNX only if the .pt is newer
	@echo make export   - always re-export MODEL (default $(MODEL))
	@echo make dev      - launch the microscopy-poc dev server
	@echo make build    - production build of microscopy-poc
	@echo make clean    - remove .venv, node_modules, public/ort
	@echo Vars: PYTHON=$(PYTHON) MODEL=path/to.pt EXPORT_ARGS="--imgsz 960"
