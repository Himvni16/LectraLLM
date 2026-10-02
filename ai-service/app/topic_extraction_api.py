from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.topic_extraction import (
    GeminiTopicModelProvider,
    TopicExtractionResult,
    TopicExtractionService,
    TopicExtractor,
    TopicProviderConfigurationError,
    TopicProviderError,
    TopicSource,
)


logger = logging.getLogger(__name__)


class TopicExtractionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)
    source: TopicSource

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Text must not be blank.")
        return cleaned


def create_topic_extraction_router(
    settings: Settings,
    extractor: TopicExtractor | None = None,
) -> APIRouter:
    router = APIRouter()
    engine = extractor

    def get_engine() -> TopicExtractor:
        nonlocal engine
        if engine is not None:
            return engine

        if settings.topic_provider != "gemini":
            raise TopicProviderConfigurationError(
                "Configured topic provider is not supported.",
            )

        api_key = (
            settings.gemini_api_key.get_secret_value()
            if settings.gemini_api_key is not None
            else ""
        )
        provider = GeminiTopicModelProvider(
            api_key=api_key,
            model=settings.gemini_topic_model,
        )
        engine = TopicExtractionService(
            provider,
            max_chunk_chars=settings.topic_chunk_chars,
        )
        return engine

    @router.post(
        "/extract-topics",
        response_model=TopicExtractionResult,
        tags=["topic-extraction"],
    )
    async def extract_topics(
        request: TopicExtractionRequest,
    ) -> TopicExtractionResult:
        try:
            return await run_in_threadpool(
                get_engine().extract,
                request.text,
                request.source,
            )
        except TopicProviderConfigurationError as error:
            logger.error("Topic extraction provider is not configured: %s", error)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Topic extraction is not configured.",
            ) from None
        except TopicProviderError as error:
            logger.exception("Topic model request failed", exc_info=error)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Topic extraction service failed.",
            ) from None
        except Exception as error:
            logger.exception("Topic extraction failed", exc_info=error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Topic extraction failed.",
            ) from None

    return router
