from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.comparison import TopicComparer
from app.comparison_api import create_comparison_router
from app.pdf_extraction import PdfExtractor
from app.pdf_extraction_api import create_pdf_extraction_router
from app.topic_extraction import TopicExtractor
from app.topic_extraction_api import create_topic_extraction_router
from app.transcription import Transcriber
from app.transcription_api import create_transcription_router


def create_app(
    *,
    settings: Settings | None = None,
    transcriber: Transcriber | None = None,
    pdf_extractor: PdfExtractor | None = None,
    topic_extractor: TopicExtractor | None = None,
    topic_comparer: TopicComparer | None = None,
) -> FastAPI:
    runtime_settings = settings or get_settings()
    application = FastAPI(
        title="LectraLLM AI Service",
        version="0.6.0",
        description="Media, document, topic, and comparison service for LectraLLM.",
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=runtime_settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    application.include_router(
        create_transcription_router(runtime_settings, transcriber),
    )
    application.include_router(
        create_pdf_extraction_router(runtime_settings, pdf_extractor),
    )
    application.include_router(
        create_topic_extraction_router(runtime_settings, topic_extractor),
    )
    application.include_router(
        create_comparison_router(runtime_settings, topic_comparer),
    )

    @application.get("/health", tags=["system"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": runtime_settings.service_name}

    return application


app = create_app()
