from __future__ import annotations

import logging
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.pdf_extraction import (
    InvalidPdfError,
    NoExtractablePdfTextError,
    PdfExtractionResult,
    PdfExtractor,
    PyMuPdfExtractor,
)


logger = logging.getLogger(__name__)

PDF_MIME_TYPES = {"application/pdf", "application/x-pdf"}
COPY_CHUNK_SIZE = 1024 * 1024


def create_pdf_extraction_router(
    settings: Settings,
    extractor: PdfExtractor | None = None,
) -> APIRouter:
    router = APIRouter()
    engine = extractor or PyMuPdfExtractor()

    @router.post(
        "/extract-pdf",
        response_model=PdfExtractionResult,
        tags=["pdf-extraction"],
    )
    async def extract_pdf(
        pdf: UploadFile = File(..., description="Text-based lecture PDF to extract"),
    ) -> PdfExtractionResult:
        original_name = Path(pdf.filename or "").name
        extension = Path(original_name).suffix.lower()
        content_type = (pdf.content_type or "").lower()

        if extension != ".pdf" or (content_type and content_type not in PDF_MIME_TYPES):
            await pdf.close()
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="File must be a PDF.",
            )

        temporary_path: Path | None = None

        try:
            with NamedTemporaryFile(delete=False, suffix=".pdf") as temporary_file:
                temporary_path = Path(temporary_file.name)
                total_size = 0

                while chunk := await pdf.read(COPY_CHUNK_SIZE):
                    total_size += len(chunk)
                    if total_size > settings.pdf_max_size_bytes:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=(
                                "PDF exceeds the configured extraction size "
                                f"limit of {settings.pdf_max_size_mb} MB."
                            ),
                        )
                    temporary_file.write(chunk)

            if total_size == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="PDF file is empty.",
                )

            return await run_in_threadpool(engine.extract, str(temporary_path))
        except HTTPException:
            raise
        except NoExtractablePdfTextError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="No extractable text found in PDF.",
            ) from error
        except InvalidPdfError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="PDF could not be read.",
            ) from error
        except Exception as error:
            logger.exception("PDF text extraction failed", exc_info=error)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="PDF text extraction failed.",
            ) from error
        finally:
            await pdf.close()
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    return router
