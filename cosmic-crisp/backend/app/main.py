from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.endpoints import router as api_v1_router
from app.core.config import get_settings
from seed import seed_database

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await seed_database()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version="2.0.0",
    description="Cosmic Crisp Precision Agriculture & Multi-Year Crop Rotation API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health/live")
async def health_live() -> dict[str, str]:
    return {"status": "ok", "service": "cosmic-crisp"}


app.include_router(api_v1_router, prefix=settings.API_V1_PREFIX)
