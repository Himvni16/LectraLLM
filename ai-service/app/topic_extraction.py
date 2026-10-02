from __future__ import annotations

import re
from enum import Enum
from typing import Any, Protocol

from google import genai
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field


DEFAULT_TOPIC_CHUNK_CHARS = 12_000
_PARAGRAPH_BOUNDARY = re.compile(r"\n\s*\n+")
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")
_TOPIC_KEY_PUNCTUATION = re.compile(r"[^\w]+", flags=re.UNICODE)


class TopicSource(str, Enum):
    VIDEO = "VIDEO"
    PDF = "PDF"


class ExtractedTopic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    confidence: float | None = Field(default=None, ge=0, le=1)


class TopicExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topics: list[ExtractedTopic]


class TopicExtractor(Protocol):
    def extract(self, text: str, source: TopicSource) -> TopicExtractionResult: ...


class TopicModelProvider(Protocol):
    def extract_chunk(
        self,
        text: str,
        source: TopicSource,
    ) -> TopicExtractionResult: ...


class TopicProviderConfigurationError(RuntimeError):
    """Raised when the configured topic provider cannot be initialized."""


class TopicProviderError(RuntimeError):
    """Raised when the configured topic provider cannot extract topics."""


def _split_words_without_cutting(text: str, max_chars: int) -> list[str]:
    parts: list[str] = []
    current: list[str] = []
    current_length = 0

    for word in text.split():
        separator_length = 1 if current else 0
        projected_length = current_length + separator_length + len(word)

        if current and projected_length > max_chars:
            parts.append(" ".join(current))
            current = [word]
            current_length = len(word)
        else:
            current.append(word)
            current_length = projected_length

    if current:
        parts.append(" ".join(current))

    return parts


def _split_oversized_paragraph(paragraph: str, max_chars: int) -> list[str]:
    parts: list[str] = []

    for sentence in _SENTENCE_BOUNDARY.split(paragraph):
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) <= max_chars:
            parts.append(sentence)
        else:
            parts.extend(_split_words_without_cutting(sentence, max_chars))

    return parts


def chunk_text(text: str, max_chars: int = DEFAULT_TOPIC_CHUNK_CHARS) -> list[str]:
    """Split text deterministically, preferring paragraph and sentence boundaries."""

    if max_chars < 1:
        raise ValueError("Topic chunk size must be positive.")

    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []

    segments: list[str] = []
    for paragraph in _PARAGRAPH_BOUNDARY.split(normalized):
        paragraph = " ".join(paragraph.split())
        if not paragraph:
            continue
        if len(paragraph) <= max_chars:
            segments.append(paragraph)
        else:
            segments.extend(_split_oversized_paragraph(paragraph, max_chars))

    chunks: list[str] = []
    current = ""

    for segment in segments:
        candidate = f"{current}\n\n{segment}" if current else segment
        if current and len(candidate) > max_chars:
            chunks.append(current)
            current = segment
        else:
            current = candidate

    if current:
        chunks.append(current)

    return chunks


def _clean_topic_name(name: str) -> str:
    return " ".join(name.split()).strip(" \t\r\n.,:;–—-")


def _topic_key(name: str) -> str:
    return " ".join(_TOPIC_KEY_PUNCTUATION.sub(" ", name.casefold()).split())


def merge_topics(results: list[TopicExtractionResult]) -> TopicExtractionResult:
    """Merge normalized duplicates while preserving first-seen topic order."""

    merged: dict[str, ExtractedTopic] = {}

    for result in results:
        for topic in result.topics:
            name = _clean_topic_name(topic.name)
            key = _topic_key(name)
            if not name or not key:
                continue

            existing = merged.get(key)
            if existing is None:
                merged[key] = ExtractedTopic(
                    name=name,
                    confidence=topic.confidence,
                )
                continue

            confidences = [
                confidence
                for confidence in (existing.confidence, topic.confidence)
                if confidence is not None
            ]
            if confidences:
                merged[key] = existing.model_copy(
                    update={"confidence": max(confidences)},
                )

    return TopicExtractionResult(topics=list(merged.values()))


class TopicExtractionService:
    def __init__(
        self,
        provider: TopicModelProvider,
        *,
        max_chunk_chars: int = DEFAULT_TOPIC_CHUNK_CHARS,
    ) -> None:
        self._provider = provider
        self._max_chunk_chars = max_chunk_chars

    def extract(self, text: str, source: TopicSource) -> TopicExtractionResult:
        chunks = chunk_text(text, self._max_chunk_chars)
        if not chunks:
            raise ValueError("Topic source text cannot be blank.")

        results: list[TopicExtractionResult] = []
        try:
            for chunk in chunks:
                results.append(self._provider.extract_chunk(chunk, source))
        except TopicProviderError:
            raise
        except Exception as error:
            raise TopicProviderError("Topic model request failed.") from error

        return merge_topics(results)


class GeminiTopicModelProvider:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        client: Any | None = None,
    ) -> None:
        if not api_key.strip():
            raise TopicProviderConfigurationError(
                "GEMINI_API_KEY is required for topic extraction.",
            )
        if not model.strip():
            raise TopicProviderConfigurationError(
                "GEMINI_TOPIC_MODEL must not be blank.",
            )

        self._model = model.strip()
        self._client = client or genai.Client(api_key=api_key)

    def extract_chunk(
        self,
        text: str,
        source: TopicSource,
    ) -> TopicExtractionResult:
        source_instruction = (
            "Extract only topics clearly discussed in the lecture transcript."
            if source is TopicSource.VIDEO
            else "Extract useful PDF topics and subtopics that are present in the text."
        )
        instructions = (
            "You extract distinct academic topics from source material. "
            f"{source_instruction} "
            "Preserve meaningful technical terminology, use concise names, and "
            "do not invent concepts. Avoid duplicates and generic labels such as "
            "Introduction, Conclusion, Summary, or Overview unless the label itself "
            "is a meaningful academic subject. Assign each topic a confidence from "
            "0 to 1 based only on evidence in this source chunk."
        )

        try:
            response = self._client.models.generate_content(
                model=self._model,
                contents=(
                    f"Source type: {source.value}\n\n"
                    "Extract structured topics from this source text:\n\n"
                    f"{text}"
                ),
                config=types.GenerateContentConfig(
                    system_instruction=instructions,
                    response_mime_type="application/json",
                    response_json_schema=TopicExtractionResult.model_json_schema(),
                    temperature=0,
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(
                        disable=True,
                    ),
                ),
            )
            response_text = response.text
        except Exception as error:
            raise TopicProviderError("Topic model request failed.") from error

        if not response_text:
            raise TopicProviderError("Topic model returned no structured output.")

        try:
            return TopicExtractionResult.model_validate_json(response_text)
        except Exception as error:
            raise TopicProviderError(
                "Topic model returned invalid structured output.",
            ) from error
