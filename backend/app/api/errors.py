"""Safe API error conventions (M5 Phase 1).

Every error response uses one predictable envelope:

    {"error": {"code": "<static_code>", "message": "<static_phrase>",
               "details": [{"field": "...", "message": "..."}]}}

Rules:
- `code` and `message` are STATIC phrases built in this module; raw exception
  text, tracebacks, stack traces, local paths, secrets, and environment
  values are never returned to API clients (detailed causes go to the server
  log only, via `logger.exception`).
- Validation details echo only field location + a static validation message;
  submitted input values are never echoed back.
- No middleware (CORS or otherwise) is registered here; CORS remains pending
  an approved origin allowlist (project decision D4).
- DemoDataError and any other unexpected failure resolve to the generic 500
  envelope: `get_articles` docstring documents demo fixtures as a hard demo
  prerequisite, so that failure is genuinely internal-to-server.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

_VALIDATION_ERROR = "validation_error"
_INTERNAL_ERROR = "internal_error"
_NOT_FOUND = "not_found"

_HTTP_STATUS_PHRASES: dict[int, tuple[str, str]] = {
    404: (_NOT_FOUND, "Resource not found."),
    405: ("method_not_allowed", "HTTP method not allowed."),
}


class ApiError(Exception):
    """Domain-level API failure with safe, static client-facing fields.

    `details` (Slice B, 2026-11-09): optional structured refusal/validation
    entries rendered through the existing `ErrorBody.details` contract. The
    base handler previously dropped none — it just never received any — so
    the default value keeps every existing raise site unchanged.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        details: list[ValidationFieldError] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


class ValidationFieldError(BaseModel):
    """One simplified validation issue: field location + static message."""

    field: str
    message: str


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[ValidationFieldError] | None = None


def _envelope(status_code: int, body: ErrorBody) -> JSONResponse:
    """Serialize the fixed envelope; `details` omitted when absent."""
    return JSONResponse(
        status_code=status_code,
        content={"error": body.model_dump(exclude_none=True)},
    )


def _api_error_handler(_: object, exc: ApiError) -> JSONResponse:
    return _envelope(
        exc.status_code,
        ErrorBody(code=exc.code, message=exc.message, details=exc.details),
    )


def _starlette_http_handler(_: object, exc: StarletteHTTPException) -> JSONResponse:
    """Route/framework HTTP failures get a static phrase by status code;
    `exc.detail` is deliberately not echoed (it is not controlled by us)."""
    code, message = _HTTP_STATUS_PHRASES.get(exc.status_code, ("http_error", "Request rejected."))
    return _envelope(exc.status_code, ErrorBody(code=code, message=message))


def _validation_handler(_: object, exc: RequestValidationError) -> JSONResponse:
    """FastAPI request validation (safe simplified shape, no input echo)."""
    details = [
        ValidationFieldError(
            field=".".join(str(part) for part in error.get("loc", ("request",))),
            message=str(error.get("msg", "invalid value")),
        )
        for error in exc.errors()[:20]  # cap response size
    ]
    return _envelope(
        422,
        ErrorBody(
            code=_VALIDATION_ERROR,
            message="Request validation failed.",
            details=details,
        ),
    )


def _generic_handler(_: object, exc: Exception) -> JSONResponse:
    """Catch-all: full cause goes to the server log, never to the client."""
    logger.exception("unhandled API error: %s: %s", type(exc).__name__, exc)
    return _envelope(500, ErrorBody(code=_INTERNAL_ERROR, message="Internal server error."))


def register_error_handlers(app: FastAPI) -> None:
    """Attach the fixed error-envelope handlers to the application."""
    app.add_exception_handler(ApiError, _api_error_handler)
    app.add_exception_handler(StarletteHTTPException, _starlette_http_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)
    app.add_exception_handler(Exception, _generic_handler)
