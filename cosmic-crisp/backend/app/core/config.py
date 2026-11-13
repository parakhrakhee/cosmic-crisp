from functools import lru_cache
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "Cosmic Crisp API"
    API_V1_PREFIX: str = "/api/v1"
    DATABASE_URL: str = "postgresql+asyncpg://cosmic:cosmic_secret@localhost:5432/cosmic_crisp"
    REDIS_URL: str = "redis://localhost:6379/0"
    NASA_POWER_BASE_URL: str = "https://power.larc.nasa.gov/api/temporal/daily/point"
    USDA_SDA_BASE_URL: str = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"
    NASA_CACHE_TTL_SECONDS: int = 86400  # 24 hours
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:3001"

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
