from __future__ import annotations

import math
from enum import Enum
from typing import Any, Protocol, Sequence

from pydantic import BaseModel, ConfigDict, Field, model_validator


STRONG_SIMILARITY_THRESHOLD = 0.75
PARTIAL_SIMILARITY_THRESHOLD = 0.55
WEAK_SIMILARITY_THRESHOLD = 0.35


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ComparisonTopic(ApiModel):
    id: str = Field(min_length=1, max_length=191)
    name: str = Field(min_length=1, max_length=160)


class CompareTopicsRequest(ApiModel):
    video_topics: list[ComparisonTopic]
    pdf_topics: list[ComparisonTopic]

    @model_validator(mode="after")
    def topic_ids_must_be_unique(self) -> "CompareTopicsRequest":
        if not self.video_topics or not self.pdf_topics:
            raise ValueError("VIDEO and PDF topics are required.")
        topic_ids = [topic.id for topic in (*self.video_topics, *self.pdf_topics)]
        if len(topic_ids) != len(set(topic_ids)):
            raise ValueError("Topic IDs must be unique.")
        return self


class MatchType(str, Enum):
    STRONG = "STRONG"
    PARTIAL = "PARTIAL"
    WEAK = "WEAK"
    MISSING = "MISSING"


class TopicComparisonMatch(ApiModel):
    pdf_topic_id: str
    video_topic_id: str | None
    similarity_score: float = Field(ge=0, le=1)
    match_type: MatchType


class TopicComparisonResult(ApiModel):
    matches: list[TopicComparisonMatch]


class TopicComparer(Protocol):
    def compare(
        self,
        video_topics: Sequence[ComparisonTopic],
        pdf_topics: Sequence[ComparisonTopic],
    ) -> TopicComparisonResult: ...


class EmbeddingModel(Protocol):
    def encode(self, sentences: list[str], **kwargs: Any) -> Any: ...


class TopicComparisonError(RuntimeError):
    """Raised when local topic comparison cannot be completed."""


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    """Return cosine similarity clamped to the Phase 6 score range of 0..1."""

    if len(left) != len(right) or not left:
        raise ValueError("Embedding vectors must be non-empty and equal in length.")

    left_values = [float(value) for value in left]
    right_values = [float(value) for value in right]
    if not all(math.isfinite(value) for value in (*left_values, *right_values)):
        raise ValueError("Embedding vectors must contain only finite values.")

    left_norm = math.sqrt(math.fsum(value * value for value in left_values))
    right_norm = math.sqrt(math.fsum(value * value for value in right_values))
    if left_norm == 0 or right_norm == 0:
        return 0.0

    dot_product = math.fsum(
        left_value * right_value
        for left_value, right_value in zip(left_values, right_values, strict=True)
    )
    raw_similarity = dot_product / (left_norm * right_norm)
    return max(0.0, min(1.0, raw_similarity))


def classify_similarity(similarity: float) -> MatchType:
    if similarity >= STRONG_SIMILARITY_THRESHOLD:
        return MatchType.STRONG
    if similarity >= PARTIAL_SIMILARITY_THRESHOLD:
        return MatchType.PARTIAL
    if similarity >= WEAK_SIMILARITY_THRESHOLD:
        return MatchType.WEAK
    return MatchType.MISSING


class SentenceTransformerTopicComparer:
    def __init__(
        self,
        model_name: str,
        *,
        model: EmbeddingModel | None = None,
    ) -> None:
        if not model_name.strip():
            raise ValueError("Embedding model name must not be blank.")
        self._model_name = model_name.strip()
        self._model = model

    def _get_model(self) -> EmbeddingModel:
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self._model_name)
        return self._model

    def compare(
        self,
        video_topics: Sequence[ComparisonTopic],
        pdf_topics: Sequence[ComparisonTopic],
    ) -> TopicComparisonResult:
        if not video_topics or not pdf_topics:
            raise ValueError("VIDEO and PDF topics are required for comparison.")

        topics = [*video_topics, *pdf_topics]
        try:
            encoded = self._get_model().encode(
                [topic.name for topic in topics],
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
            vectors = [list(vector) for vector in encoded]
        except Exception as error:
            raise TopicComparisonError("Topic embeddings could not be generated.") from error

        if len(vectors) != len(topics):
            raise TopicComparisonError("Embedding model returned an invalid result.")

        video_vectors = vectors[: len(video_topics)]
        pdf_vectors = vectors[len(video_topics) :]
        matches: list[TopicComparisonMatch] = []

        for pdf_topic, pdf_vector in zip(pdf_topics, pdf_vectors, strict=True):
            best_index = 0
            best_similarity = cosine_similarity(pdf_vector, video_vectors[0])

            for index in range(1, len(video_topics)):
                similarity = cosine_similarity(pdf_vector, video_vectors[index])
                if similarity > best_similarity:
                    best_index = index
                    best_similarity = similarity

            match_type = classify_similarity(best_similarity)
            matches.append(
                TopicComparisonMatch(
                    pdf_topic_id=pdf_topic.id,
                    video_topic_id=(
                        None
                        if match_type is MatchType.MISSING
                        else video_topics[best_index].id
                    ),
                    similarity_score=best_similarity,
                    match_type=match_type,
                )
            )

        return TopicComparisonResult(matches=matches)
