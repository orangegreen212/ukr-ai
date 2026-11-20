"""Main entry point for the FastAPI application.

Creates the app instance and registers all routes + error handlers.
Vercel auto-detects `app:app` from this module.
"""

from fastapi import FastAPI

from app.api.errors import register_error_handlers
from app.api.v1 import build_v1_router
from app.config import load_config


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Ukrainian AI Intelligence Platform (Online Edition)",
        version="0.2.0",
        description="Live RSS ingestion + sentiment + NER only",
    )

    # Register error envelope handlers
    register_error_handlers(app)

    # Register the versioned API router (Phase 1 + Phase 2 analysis)
    v1_router = build_v1_router()
    app.include_router(v1_router, tags=["v1"])

    return app


# Vercel auto-detection: module-level `app` object
app = create_app()