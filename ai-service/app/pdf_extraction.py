from __future__ import annotations

import re
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field


class PdfExtractionResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    text: str
    page_count: int = Field(serialization_alias="pageCount")
    character_count: int = Field(serialization_alias="characterCount")


class InvalidPdfError(Exception):
    """Raised when an uploaded file cannot be parsed as a PDF."""


class NoExtractablePdfTextError(Exception):
    """Raised when a valid PDF contains no extractable text."""


class PdfExtractor(Protocol):
    def extract(self, pdf_path: str) -> PdfExtractionResult: ...


def clean_extracted_text(text: str) -> str:
    """Apply conservative whitespace cleanup without rewriting document wording."""

    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    cleaned_lines: list[str] = []

    for line in normalized.split("\n"):
        cleaned_line = re.sub(r"[\t\f\v ]+", " ", line).strip()

        if cleaned_line:
            cleaned_lines.append(cleaned_line)
        elif cleaned_lines and cleaned_lines[-1] != "":
            cleaned_lines.append("")

    return "\n".join(cleaned_lines).strip()


class PyMuPdfExtractor:
    def extract(self, pdf_path: str) -> PdfExtractionResult:
        import pymupdf

        try:
            contents = Path(pdf_path).read_bytes()
            with pymupdf.open(stream=contents, filetype="pdf") as document:
                if not document.is_pdf or document.needs_pass:
                    raise InvalidPdfError()

                page_count = document.page_count
                page_texts = [
                    cleaned
                    for page in document
                    if (cleaned := clean_extracted_text(page.get_text("text", sort=True)))
                ]
        except InvalidPdfError:
            raise
        except Exception as error:
            raise InvalidPdfError() from error

        text = "\n\n".join(page_texts).strip()

        if not text:
            raise NoExtractablePdfTextError()

        return PdfExtractionResult(
            text=text,
            page_count=page_count,
            character_count=len(text),
        )
