"""FastAPI application setup for the synthetic-data GoNurse demonstration."""

import logging
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.orm import sessionmaker

from . import database as db
from .routers import navigator, opportunities, profiles, recommendations, support

logger = logging.getLogger("gonurse")


def seed(session):
    """Insert two synthetic listings on a fresh prototype database."""
    if session.get(db.Opportunity, "10000000-0000-4000-8000-000000000001") is None:
        session.add_all([
            db.Opportunity(id="10000000-0000-4000-8000-000000000001", title="Nurse mentoring committee",
                description="Help develop a mentoring program.", category="committee",
                required_skills=["mentoring"], interests=["education"], availability=["weekday_morning"], status="open"),
            db.Opportunity(id="10000000-0000-4000-8000-000000000002", title="Pediatric education project",
                description="Create learning resources for nursing staff.", category="project",
                required_skills=["pediatric nursing"], interests=["education"], availability=[], status="open"),
        ])
        session.commit()


@asynccontextmanager
async def lifespan(_app):
    """Create prototype tables and seed data before accepting requests."""
    engine = db.get_engine()
    db.Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as session:
        seed(session)
    yield


# The local Vite development server is the only allowed browser origin.
app = FastAPI(title="GoNurse local prototype", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["GET", "POST", "PUT", "PATCH"], allow_headers=["Content-Type", "X-Demo-User"])


def error(status, code, message, details=None):
    """Return the common API error envelope with a new request identifier."""
    return JSONResponse(status_code=status, content={"error": {
        "code": code, "message": message, "details": details or [], "request_id": str(uuid4())}})


@app.exception_handler(HTTPException)
async def http_error(_request, exc):
    """Convert deliberate HTTP errors to the shared response format."""
    return error(exc.status_code, f"HTTP_{exc.status_code}", str(exc.detail))


@app.exception_handler(RequestValidationError)
async def validation_error(_request, exc):
    """Return invalid field locations without echoing submitted values."""
    details = [{"field": ".".join(str(x) for x in item["loc"]), "message": item["msg"]} for item in exc.errors()]
    return error(422, "VALIDATION_ERROR", "One or more fields are invalid.", details)


@app.exception_handler(Exception)
async def unexpected_error(_request, exc):
    """Log the exception type while keeping internal details out of responses."""
    logger.error("Request failed: %s", type(exc).__name__)
    return error(500, "INTERNAL_ERROR", "The request could not be completed.")


app.include_router(profiles.router)
app.include_router(opportunities.router)
app.include_router(recommendations.router)
app.include_router(navigator.router)
app.include_router(support.router)
