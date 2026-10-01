from __future__ import annotations

import logging
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.transcription import (
    FasterWhisperTranscriber,
    Transcriber,
    TranscriptionResult,
)


logger = logging.getLogger(__name__)

VIDEO_MIME_TYPES_BY_EXTENSION: dict[str, set[str]] = {
    ".mp4": {"video/mp4"},
    ".mov": {"video/quicktime", "video/mov", "video/x-quicktime"},
    ".webm": {"video/webm"},
}
COPY_CHUNK_SIZE = 1024 * 1024


def create_transcription_router(
    settings: Settings,
    transcriber: Transcriber | None = None,
) -> APIRouter:
    router = APIRouter()
    engine = transcriber or FasterWhisperTranscriber(
        model_name=settings.whisper_model,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
    )

    @router.post(
        "/transcribe",
        response_model=TranscriptionResult,
        tags=["transcription"],
    )
    async def transcribe_media(
        media: UploadFile = File(..., description="Lecture video to transcribe"),
    ) -> TranscriptionResult:
        original_name = Path(media.filename or "").name
        extension = Path(original_name).suffix.lower()
        allowed_mime_types = VIDEO_MIME_TYPES_BY_EXTENSION.get(extension)
        content_type = (media.content_type or "").lower()

        if not allowed_mime_types or (
            content_type and content_type not in allowed_mime_types
        ):
            await media.close()
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Media must be an MP4, MOV, or WebM video.",
            )

        temporary_path: Path | None = None

        try:
            with NamedTemporaryFile(delete=False, suffix=extension) as temporary_file:
                temporary_path = Path(temporary_file.name)
                total_size = 0

                while chunk := await media.read(COPY_CHUNK_SIZE):
                    total_size += len(chunk)
                    if total_size > settings.transcription_max_size_bytes:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=(
                                "Media exceeds the configured transcription size "
                                f"limit of {settings.transcription_max_size_mb} MB."
                            ),
                        )
                    temporary_file.write(chunk)

            if total_size == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Media file is empty.",
                )

            return await run_in_threadpool(engine.transcribe, str(temporary_path))
        except HTTPException:
            raise
        except Exception as error:
            logger.exception("Lecture transcription failed", exc_info=error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="The lecture could not be transcribed.",
            ) from error
        finally:
            await media.close()
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    return router
