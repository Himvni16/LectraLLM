from pathlib import Path

import pymupdf
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.pdf_extraction import (
    PdfExtractionResult,
    PdfExtractor,
    PyMuPdfExtractor,
    clean_extracted_text,
)


def create_pdf_bytes(*page_texts: str | None) -> bytes:
    document = pymupdf.open()
    try:
        for text in page_texts:
            page = document.new_page()
            if text:
                page.insert_text((72, 72), text)
        return document.tobytes()
    finally:
        document.close()


class CapturingPdfExtractor:
    def __init__(self, delegate: PdfExtractor | None = None) -> None:
        self.delegate = delegate or PyMuPdfExtractor()
        self.pdf_path: str | None = None

    def extract(self, pdf_path: str) -> PdfExtractionResult:
        self.pdf_path = pdf_path
        assert Path(pdf_path).is_file()
        return self.delegate.extract(pdf_path)


class FailingPdfExtractor:
    def __init__(self) -> None:
        self.pdf_path: str | None = None

    def extract(self, pdf_path: str) -> PdfExtractionResult:
        self.pdf_path = pdf_path
        assert Path(pdf_path).is_file()
        raise RuntimeError(f"parser failed for {pdf_path}")


def create_client(
    extractor: PdfExtractor | None = None,
    settings: Settings | None = None,
) -> TestClient:
    return TestClient(
        create_app(
            settings=settings or Settings(_env_file=None),
            pdf_extractor=extractor or PyMuPdfExtractor(),
        )
    )


def test_pdf_extraction_requires_a_file() -> None:
    response = create_client().post("/extract-pdf")

    assert response.status_code == 422


def test_pdf_extraction_rejects_non_pdf_media() -> None:
    response = create_client().post(
        "/extract-pdf",
        files={"pdf": ("notes.txt", b"plain text", "text/plain")},
    )

    assert response.status_code == 415
    assert response.json() == {"detail": "File must be a PDF."}


def test_pdf_extraction_rejects_an_empty_pdf() -> None:
    response = create_client().post(
        "/extract-pdf",
        files={"pdf": ("notes.pdf", b"", "application/pdf")},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "PDF file is empty."}


def test_pdf_extraction_enforces_the_configured_size_limit() -> None:
    settings = Settings(_env_file=None, PDF_MAX_SIZE_MB=1)
    response = create_client(settings=settings).post(
        "/extract-pdf",
        files={
            "pdf": (
                "notes.pdf",
                b"%PDF" + (b"x" * 1024 * 1024),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 413
    assert response.json() == {
        "detail": "PDF exceeds the configured extraction size limit of 1 MB."
    }


def test_pdf_extraction_rejects_invalid_pdf_and_cleans_temp_file() -> None:
    extractor = CapturingPdfExtractor()
    response = create_client(extractor).post(
        "/extract-pdf",
        files={"pdf": ("notes.pdf", b"not-a-pdf", "application/pdf")},
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "PDF could not be read."}
    assert extractor.pdf_path is not None
    assert extractor.pdf_path not in response.text
    assert not Path(extractor.pdf_path).exists()


def test_pdf_extraction_uses_real_pdf_and_returns_clean_text() -> None:
    extractor = CapturingPdfExtractor()
    response = create_client(extractor).post(
        "/extract-pdf",
        files={
            "pdf": (
                "lecture.pdf",
                create_pdf_bytes(
                    "Introduction to deadlocks.",
                    "Mutual exclusion is a deadlock condition.",
                ),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "text": (
            "Introduction to deadlocks.\n\n"
            "Mutual exclusion is a deadlock condition."
        ),
        "pageCount": 2,
        "characterCount": 69,
    }
    assert extractor.pdf_path is not None
    assert not Path(extractor.pdf_path).exists()


def test_pdf_extraction_reports_pdf_with_no_text() -> None:
    response = create_client().post(
        "/extract-pdf",
        files={
            "pdf": (
                "scanned.pdf",
                create_pdf_bytes(None),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "No extractable text found in PDF."}


def test_pdf_extraction_sanitizes_unexpected_parser_errors() -> None:
    extractor = FailingPdfExtractor()
    response = create_client(extractor).post(
        "/extract-pdf",
        files={
            "pdf": (
                "lecture.pdf",
                create_pdf_bytes("Readable text"),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 500
    assert response.json() == {"detail": "PDF text extraction failed."}
    assert extractor.pdf_path is not None
    assert extractor.pdf_path not in response.text
    assert not Path(extractor.pdf_path).exists()


def test_light_cleanup_preserves_wording_and_paragraphs() -> None:
    assert clean_extracted_text("  First   line  \r\n\r\n\r\nSecond\tline  ") == (
        "First line\n\nSecond line"
    )
