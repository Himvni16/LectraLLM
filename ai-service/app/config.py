from functools import lru_cache

from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the AI service."""

    service_name: str = "lectrallm-ai"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    whisper_model: str = Field(
        default="base",
        validation_alias=AliasChoices("WHISPER_MODEL", "AI_WHISPER_MODEL"),
    )
    whisper_device: str = Field(
        default="cpu",
        validation_alias=AliasChoices("WHISPER_DEVICE", "AI_WHISPER_DEVICE"),
    )
    whisper_compute_type: str = Field(
        default="int8",
        validation_alias=AliasChoices(
            "WHISPER_COMPUTE_TYPE",
            "AI_WHISPER_COMPUTE_TYPE",
        ),
    )
    transcription_max_size_mb: int = Field(
        default=100,
        gt=0,
        validation_alias=AliasChoices(
            "TRANSCRIPTION_MAX_SIZE_MB",
            "AI_TRANSCRIPTION_MAX_SIZE_MB",
        ),
    )
    pdf_max_size_mb: int = Field(
        default=25,
        gt=0,
        validation_alias=AliasChoices("PDF_MAX_SIZE_MB", "AI_PDF_MAX_SIZE_MB"),
    )
    topic_provider: Literal["gemini"] = Field(
        default="gemini",
        validation_alias=AliasChoices("TOPIC_PROVIDER", "AI_TOPIC_PROVIDER"),
    )
    gemini_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("GEMINI_API_KEY", "AI_GEMINI_API_KEY"),
    )
    gemini_topic_model: str = Field(
        default="gemini-3.5-flash-lite",
        min_length=1,
        validation_alias=AliasChoices(
            "GEMINI_TOPIC_MODEL",
            "AI_GEMINI_TOPIC_MODEL",
        ),
    )
    topic_chunk_chars: int = Field(
        default=12_000,
        ge=1_000,
        le=100_000,
        validation_alias=AliasChoices("TOPIC_CHUNK_CHARS", "AI_TOPIC_CHUNK_CHARS"),
    )
    embedding_model: str = Field(
        default="sentence-transformers/all-MiniLM-L6-v2",
        min_length=1,
        validation_alias=AliasChoices("EMBEDDING_MODEL", "AI_EMBEDDING_MODEL"),
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="AI_",
        extra="ignore",
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def transcription_max_size_bytes(self) -> int:
        return self.transcription_max_size_mb * 1024 * 1024

    @property
    def pdf_max_size_bytes(self) -> int:
        return self.pdf_max_size_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
