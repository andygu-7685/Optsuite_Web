import hmac
import os
import secrets
import shutil
import uuid
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

import cv2
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from PIL import Image

from backend.processor import OVERLAY_STYLES, analyze, draw_overlay

DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "runtime-data"
DATA_DIR = Path(os.getenv("USAF_DATA_DIR", str(DEFAULT_DATA_DIR))).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

MAX_BYTES = 50 * 1024 * 1024
MAX_PIXELS = 100_000_000
MAX_PENDING = 20
ALLOWED_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"
}

# POC only: this registry disappears when the server restarts.
jobs = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = ProcessPoolExecutor(max_workers=2)
    yield
    app.state.pool.shutdown(wait=True)


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Job-Token"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


def get_job(job_id: str, token: str | None):
    job = jobs.get(job_id)
    if not job or not token or not hmac.compare_digest(
        token, job["token"]
    ):
        raise HTTPException(404, "Analysis not found")
    return job


@app.post("/api/analyses", status_code=202)
def create_analysis(
    file: UploadFile = File(...),
    overlay_style: str = Form("classic"),
    flipped: bool | None = Form(None),
):
    if overlay_style not in OVERLAY_STYLES:
        raise HTTPException(422, "Unknown overlay style")
    pending = sum(not job["future"].done() for job in jobs.values())
    if pending >= MAX_PENDING:
        raise HTTPException(429, "Analysis queue is full")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, "Unsupported image type")

    job_id = str(uuid.uuid4())
    token = secrets.token_urlsafe(32)
    job_dir = DATA_DIR / job_id
    job_dir.mkdir()
    image_path = job_dir / f"original{suffix}"

    try:
        size = 0
        with image_path.open("wb") as output:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise HTTPException(413, "Image is too large")
                output.write(chunk)

        if size == 0:
            raise HTTPException(400, "Image is empty")

        try:
            with Image.open(image_path) as image:
                if image.width * image.height > MAX_PIXELS:
                    raise HTTPException(413, "Image dimensions are too large")
                image.verify()
        except OSError as exc:
            raise HTTPException(400, "Invalid image") from exc

        future = app.state.pool.submit(
            analyze, str(image_path), str(job_dir), overlay_style, flipped
        )
        jobs[job_id] = {
            "token": token,
            "future": future,
            "dir": job_dir,
            "image_path": image_path,
        }
        return {"id": job_id, "token": token, "status": "queued"}

    except Exception:
        shutil.rmtree(job_dir)
        raise


@app.get("/api/analyses/{job_id}")
def get_analysis(
    job_id: str,
    x_job_token: str | None = Header(default=None),
):
    job = get_job(job_id, x_job_token)
    future = job["future"]

    if not future.done():
        return {
            "id": job_id,
            "status": "running" if future.running() else "queued",
        }

    try:
        result = future.result()
    except Exception:
        return {
            "id": job_id,
            "status": "failed",
            "error": "Registration or scoring failed",
        }

    return {
        "id": job_id,
        "status": "completed",
        "result": result,
        "overlay_url": f"/api/analyses/{job_id}/overlay",
    }


@app.get("/api/analyses/{job_id}/overlay")
def get_overlay(
    job_id: str,
    x_job_token: str | None = Header(default=None),
    overlay_style: str | None = None,
):
    job = get_job(job_id, x_job_token)
    if overlay_style is not None:
        if overlay_style not in OVERLAY_STYLES:
            raise HTTPException(422, "Unknown overlay style")
        style = OVERLAY_STYLES[overlay_style]

        if not job["future"].done():
            raise HTTPException(404, "Overlay not ready")
        try:
            result = job["future"].result()
        except Exception as exc:
            raise HTTPException(404, "Overlay not ready") from exc
        image = cv2.imread(str(job["image_path"]))
        if image is None:
            raise HTTPException(404, "Original image not found")
        overlay = draw_overlay(image, result["elements"], result["best"], style)
        encoded, buffer = cv2.imencode(".png", overlay)
        if not encoded:
            raise HTTPException(500, "Could not encode overlay")
        return Response(content=buffer.tobytes(), media_type="image/png")

    path = job["dir"] / "overlay.png"
    if not path.is_file():
        raise HTTPException(404, "Overlay not ready")
    return FileResponse(path, media_type="image/png")
