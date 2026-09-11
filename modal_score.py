"""
Score a Supabase-stored image on Modal with score_image_routine.

Setup (once):
  pip install modal
  modal setup
  modal secret create supabase SUPABASE_URL=https://YOUR_PROJECT.supabase.co SUPABASE_ANON_KEY=YOUR_ANON_KEY

Run one image:
  modal run modal_score.py --image-id <uuid>
  modal run modal_score.py --storage-path "<uuid>/photo.png"

Deploy an HTTP endpoint:
  modal deploy modal_score.py
  # POST JSON: {"image_id": "<uuid>"}  or  {"storage_path": "<uuid>/photo.png"}
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import modal

APP_NAME = "usaf-score"
SOURCE_IMAGE_BUCKET = "source-images"
PACKAGE_DIR = Path(__file__).resolve().parent / "usaf_registration"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "opencv-python-headless",
        "numpy",
        "scipy",
        "matplotlib",
        "ultralytics",
        "supabase",
        "fastapi",
    )
    .env({"PYTHONPATH": "/root", "MPLBACKEND": "Agg"})
    # Package code plus YOLO weights and SIFT reference images. Training sets stay local.
    .add_local_dir(
        str(PACKAGE_DIR),
        remote_path="/root/usaf_registration",
        ignore=["**/__pycache__/**", "training_img1/**", "training_img2/**", "ideal_test/**"],
    )
)

app = modal.App(APP_NAME, image=image)


def _jsonable(value):
    """Convert numpy / Path values so the Modal / HTTP response can be JSON."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "tolist"):
        return _jsonable(value.tolist())
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return str(value)


def _parse_usaf_result(raw):
    """Turn the list returned by score_image_routine into a stable JSON object."""
    if raw is None:
        return None

    parsed = {"raw": _jsonable(raw)}
    if isinstance(raw, (list, tuple)) and len(raw) >= 1:
        group = raw[0]
        if isinstance(group, (list, tuple)) and len(group) >= 2:
            parsed["group"] = _jsonable(group[0])
            parsed["element"] = _jsonable(group[1])
        if len(raw) >= 2:
            parsed["chosen_index"] = _jsonable(raw[1])
        if len(raw) >= 3:
            parsed["scanline_map"] = _jsonable(raw[2])
        if len(raw) >= 4:
            parsed["scores"] = _jsonable(raw[3])
    return parsed


def _supabase_client():
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError(
            "Missing SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY). "
            "Create a Modal secret named 'supabase'."
        )
    return create_client(url, key)


def _download_image(client, storage_path: str, dest_dir: Path) -> Path:
    blob = client.storage.from_(SOURCE_IMAGE_BUCKET).download(storage_path)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / Path(storage_path).name
    dest.write_bytes(blob)
    return dest


def _resolve_image(client, image_id: str | None, storage_path: str | None):
    """Look up metadata in public.images when only an id is given."""
    if storage_path:
        name = Path(storage_path).name
        resolved_id = image_id
        if image_id is None:
            lookup = (
                client.table("images")
                .select("id, name, storage_path")
                .eq("storage_path", storage_path)
                .limit(1)
                .execute()
            )
            if lookup.data:
                resolved_id = lookup.data[0]["id"]
                name = lookup.data[0]["name"]
        return resolved_id, storage_path, name

    if not image_id:
        raise ValueError("Provide image_id or storage_path")

    row = client.table("images").select("id, name, storage_path").eq("id", image_id).single().execute()
    data = row.data
    if not data or not data.get("storage_path"):
        raise FileNotFoundError(f"No storage_path for image id {image_id}")
    return data["id"], data["storage_path"], data["name"]


def _score_local_file(image_path: Path):
    from usaf_registration import constants as C
    from usaf_registration.usaf_algo import score_image_routine

    # Keep logs and pattern crops on the writable tmp filesystem.
    C.LOG_PATH = Path("/tmp/usaf_logs")
    C.LOG_PATH.mkdir(parents=True, exist_ok=True)
    C.CROP_DIR = Path("/tmp/pattern_crop")

    return score_image_routine(str(image_path))


def _run_score(image_id: str | None, storage_path: str | None) -> dict:
    client = _supabase_client()
    resolved_id, resolved_path, name = _resolve_image(client, image_id, storage_path)
    local_path = _download_image(client, resolved_path, Path("/tmp/usaf_input"))

    try:
        raw = _score_local_file(local_path)
    except Exception as exc:
        return {
            "ok": False,
            "image_id": resolved_id,
            "storage_path": resolved_path,
            "name": name,
            "error": str(exc),
        }

    if raw is None:
        return {
            "ok": False,
            "image_id": resolved_id,
            "storage_path": resolved_path,
            "name": name,
            "error": "score_image_routine returned no result",
        }

    return {
        "ok": True,
        "image_id": resolved_id,
        "storage_path": resolved_path,
        "name": name,
        "result": _parse_usaf_result(raw),
    }


@app.function(
    secrets=[modal.Secret.from_name("supabase")],
    timeout=15 * 60,
    memory=8192,
)
def score_supabase_image(image_id: str | None = None, storage_path: str | None = None) -> dict:
    """Download one image from Supabase Storage and run score_image_routine."""
    return _run_score(image_id, storage_path)


@app.function(
    secrets=[modal.Secret.from_name("supabase")],
    timeout=15 * 60,
    memory=8192,
)
@modal.fastapi_endpoint(method="POST")
def score_http(item: dict) -> dict:
    """HTTP wrapper: POST {"image_id": "..."} or {"storage_path": "..."}."""
    return _run_score(item.get("image_id"), item.get("storage_path"))


@app.local_entrypoint()
def main(image_id: str = "", storage_path: str = ""):
    result = score_supabase_image.remote(
        image_id=image_id or None,
        storage_path=storage_path or None,
    )
    print(json.dumps(result, indent=2))
