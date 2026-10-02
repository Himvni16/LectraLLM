from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.pdf_extraction import PdfExtractor
from app.pdf_extraction_api import create_pdf_extraction_router
from app.transcription import Transcriber
from app.transcription_api import create_transcription_router


def create_app(
    *,
    settings: Settings | None = None,
    transcriber: Transcriber | None = None,
    pdf_extractor: PdfExtractor | None = None,
) -> FastAPI:
    runtime_settings = settings or get_settings()
    application = FastAPI(
        title="LectraLLM AI Service",
        version="0.4.0",
        description="Local media-processing service for LectraLLM.",
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

    @application.get("/health", tags=["system"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": runtime_settings.service_name}

    return application


app = create_app()
