from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.comparison import (
    CompareTopicsRequest,
    ComparisonTopic,
    MatchType,
    SentenceTransformerTopicComparer,
    TopicComparisonMatch,
    TopicComparisonResult,
    classify_similarity,
    cosine_similarity,
)
from app.config import Settings
from app.main import create_app


class StaticEmbeddingModel:
    def __init__(self, vectors_by_name: dict[str, list[float]]) -> None:
        self.vectors_by_name = vectors_by_name
        self.calls: list[tuple[list[str], dict[str, Any]]] = []

    def encode(self, sentences: list[str], **kwargs: Any) -> list[list[float]]:
        self.calls.append((sentences, kwargs))
        return [self.vectors_by_name[sentence] for sentence in sentences]


class CapturingComparer:
    def __init__(self, result: TopicComparisonResult | None = None) -> None:
        self.calls = 0
        self.result = result or TopicComparisonResult(matches=[])

    def compare(
        self,
        video_topics: list[ComparisonTopic],
        pdf_topics: list[ComparisonTopic],
    ) -> TopicComparisonResult:
        del video_topics, pdf_topics
        self.calls += 1
        return self.result


def topic(topic_id: str, name: str) -> ComparisonTopic:
    return ComparisonTopic(id=topic_id, name=name)


def test_cosine_similarity_is_bounded_and_deterministic() -> None:
    assert cosine_similarity([1, 0], [1, 0]) == pytest.approx(1.0)
    assert cosine_similarity([1, 0], [0.8, 0.6]) == pytest.approx(0.8)
    assert cosine_similarity([1, 0], [0, 1]) == pytest.approx(0.0)
    assert cosine_similarity([1, 0], [-1, 0]) == pytest.approx(0.0)


@pytest.mark.parametrize(
    ("similarity", "expected"),
    [
        (1.0, MatchType.STRONG),
        (0.75, MatchType.STRONG),
        (0.7499, MatchType.PARTIAL),
        (0.55, MatchType.PARTIAL),
        (0.5499, MatchType.WEAK),
        (0.35, MatchType.WEAK),
        (0.3499, MatchType.MISSING),
        (0.0, MatchType.MISSING),
    ],
)
def test_match_threshold_boundaries(
    similarity: float,
    expected: MatchType,
) -> None:
    assert classify_similarity(similarity) is expected


def test_selects_one_best_video_match_for_every_pdf_topic() -> None:
    model = StaticEmbeddingModel(
        {
            "Deadlocks": [1.0, 0.0, 0.0],
            "Virtual Memory": [0.0, 1.0, 0.0],
            "Deadlock Prevention": [0.9, 0.1, 0.0],
            "Page Replacement": [0.1, 0.9, 0.0],
        }
    )
    comparer = SentenceTransformerTopicComparer("test-model", model=model)

    result = comparer.compare(
        [topic("video-1", "Deadlocks"), topic("video-2", "Virtual Memory")],
        [
            topic("pdf-1", "Deadlock Prevention"),
            topic("pdf-2", "Page Replacement"),
        ],
    )

    assert len(result.matches) == 2
    assert [match.pdf_topic_id for match in result.matches] == ["pdf-1", "pdf-2"]
    assert [match.video_topic_id for match in result.matches] == [
        "video-1",
        "video-2",
    ]
    assert all(match.match_type is MatchType.STRONG for match in result.matches)
    assert model.calls[0][1] == {
        "normalize_embeddings": True,
        "convert_to_numpy": True,
        "show_progress_bar": False,
    }


def test_unrelated_pdf_topic_is_returned_as_missing() -> None:
    model = StaticEmbeddingModel(
        {
            "Deadlocks": [1.0, 0.0],
            "Renaissance Poetry": [0.0, 1.0],
        }
    )
    comparer = SentenceTransformerTopicComparer("test-model", model=model)

    result = comparer.compare(
        [topic("video-1", "Deadlocks")],
        [topic("pdf-1", "Renaissance Poetry")],
    )

    assert result.matches[0].model_dump() == {
        "pdf_topic_id": "pdf-1",
        "video_topic_id": None,
        "similarity_score": 0.0,
        "match_type": MatchType.MISSING,
    }


@pytest.mark.parametrize(
    "payload",
    [
        {"video_topics": [], "pdf_topics": [{"id": "pdf-1", "name": "Deadlocks"}]},
        {"video_topics": [{"id": "video-1", "name": "Deadlocks"}], "pdf_topics": []},
    ],
)
def test_compare_endpoint_rejects_empty_topic_groups(payload: dict[str, Any]) -> None:
    comparer = CapturingComparer()
    client = TestClient(
        create_app(settings=Settings(_env_file=None), topic_comparer=comparer)
    )

    response = client.post("/compare-topics", json=payload)

    assert response.status_code == 422
    assert comparer.calls == 0


def test_compare_endpoint_returns_structured_pdf_directed_matches() -> None:
    comparer = CapturingComparer(
        TopicComparisonResult(
            matches=[
                TopicComparisonMatch(
                    pdf_topic_id="pdf-1",
                    video_topic_id="video-1",
                    similarity_score=0.82,
                    match_type=MatchType.STRONG,
                )
            ]
        )
    )
    client = TestClient(
        create_app(settings=Settings(_env_file=None), topic_comparer=comparer)
    )

    response = client.post(
        "/compare-topics",
        json={
            "video_topics": [{"id": "video-1", "name": "Deadlocks"}],
            "pdf_topics": [{"id": "pdf-1", "name": "Deadlock Prevention"}],
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "matches": [
            {
                "pdf_topic_id": "pdf-1",
                "video_topic_id": "video-1",
                "similarity_score": 0.82,
                "match_type": "STRONG",
            }
        ]
    }
    assert comparer.calls == 1


def test_request_rejects_duplicate_topic_ids() -> None:
    with pytest.raises(ValueError, match="Topic IDs must be unique"):
        CompareTopicsRequest.model_validate(
            {
                "video_topics": [{"id": "topic-1", "name": "Deadlocks"}],
                "pdf_topics": [{"id": "topic-1", "name": "Deadlocks"}],
            }
        )
