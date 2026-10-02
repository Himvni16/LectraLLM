from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from starlette.concurrency import run_in_threadpool

from app.comparison import (
    CompareTopicsRequest,
    SentenceTransformerTopicComparer,
    TopicComparer,
    TopicComparisonError,
    TopicComparisonResult,
)
from app.config import Settings


logger = logging.getLogger(__name__)


def create_comparison_router(
    settings: Settings,
    comparer: TopicComparer | None = None,
) -> APIRouter:
    router = APIRouter()
    engine = comparer or SentenceTransformerTopicComparer(settings.embedding_model)

    @router.post(
        "/compare-topics",
        response_model=TopicComparisonResult,
        tags=["topic-comparison"],
    )
    async def compare_topics(
        request: CompareTopicsRequest,
    ) -> TopicComparisonResult:
        try:
            return await run_in_threadpool(
                engine.compare,
                request.video_topics,
                request.pdf_topics,
            )
        except TopicComparisonError as error:
            logger.exception("Local topic comparison failed", exc_info=error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Topic comparison service failed.",
            ) from None
        except Exception as error:
            logger.exception("Topic comparison failed", exc_info=error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Topic comparison failed.",
            ) from None

    return router
