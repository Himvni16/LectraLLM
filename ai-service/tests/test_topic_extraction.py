from __future__ import annotations

import json
from types import SimpleNamespace

from fastapi.testclient import TestClient
from google.genai import types as genai_types

from app.config import Settings
from app.main import create_app
from app.topic_extraction import (
    ExtractedTopic,
    GeminiTopicModelProvider,
    TopicExtractionResult,
    TopicExtractionService,
    TopicProviderError,
    TopicSource,
    chunk_text,
)


class CapturingExtractor:
    def __init__(self, result: TopicExtractionResult) -> None:
        self.result = result
        self.calls: list[tuple[str, TopicSource]] = []

    def extract(self, text: str, source: TopicSource) -> TopicExtractionResult:
        self.calls.append((text, source))
        return self.result


class FailingExtractor:
    def extract(self, text: str, source: TopicSource) -> TopicExtractionResult:
        del text, source
        raise TopicProviderError("upstream leaked secret AIza-test-private")


class CapturingProvider:
    def __init__(self) -> None:
        self.chunks: list[str] = []

    def extract_chunk(
        self,
        text: str,
        source: TopicSource,
    ) -> TopicExtractionResult:
        del source
        self.chunks.append(text)
        confidence = 0.7 if len(self.chunks) == 1 else 0.9
        name = "Deadlocks" if len(self.chunks) == 1 else "deadlocks."
        return TopicExtractionResult(
            topics=[ExtractedTopic(name=name, confidence=confidence)]
        )


class FakeModels:
    def __init__(self, response_text: str, error: Exception | None = None) -> None:
        self.response_text = response_text
        self.error = error
        self.kwargs: dict[str, object] | None = None

    def generate_content(self, **kwargs: object) -> SimpleNamespace:
        self.kwargs = kwargs
        if self.error is not None:
            raise self.error
        return SimpleNamespace(text=self.response_text)


class FakeGeminiClient:
    def __init__(self, response_text: str, error: Exception | None = None) -> None:
        self.models = FakeModels(response_text, error)


def create_client(extractor: object | None = None) -> TestClient:
    return TestClient(
        create_app(
            settings=Settings(_env_file=None),
            topic_extractor=extractor,
        )
    )


def test_topic_extraction_rejects_blank_text() -> None:
    response = create_client().post(
        "/extract-topics",
        json={"text": "   \n\t", "source": "VIDEO"},
    )

    assert response.status_code == 422


def test_topic_extraction_rejects_invalid_source() -> None:
    response = create_client().post(
        "/extract-topics",
        json={"text": "Deadlock prevention", "source": "SLIDES"},
    )

    assert response.status_code == 422


def test_topic_extraction_returns_structured_topics() -> None:
    extractor = CapturingExtractor(
        TopicExtractionResult(
            topics=[ExtractedTopic(name="Deadlock Prevention", confidence=0.93)]
        )
    )
    response = create_client(extractor).post(
        "/extract-topics",
        json={"text": "  Deadlock prevention breaks a necessary condition.  ", "source": "VIDEO"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "topics": [{"name": "Deadlock Prevention", "confidence": 0.93}]
    }
    assert extractor.calls == [
        (
            "Deadlock prevention breaks a necessary condition.",
            TopicSource.VIDEO,
        )
    ]


def test_long_text_uses_bounded_chunks_and_merges_duplicates() -> None:
    provider = CapturingProvider()
    service = TopicExtractionService(provider, max_chunk_chars=80)
    text = (
        "Deadlocks occur when processes wait for resources. "
        "Mutual exclusion is one necessary condition.\n\n"
        "Deadlock prevention breaks at least one necessary condition. "
        "Resource ordering can prevent circular wait."
    )

    result = service.extract(text, TopicSource.PDF)

    assert len(provider.chunks) > 1
    assert all(len(chunk) <= 80 for chunk in provider.chunks)
    assert " ".join(" ".join(provider.chunks).split()) == " ".join(text.split())
    assert result == TopicExtractionResult(
        topics=[ExtractedTopic(name="Deadlocks", confidence=0.9)]
    )


def test_chunking_does_not_split_an_oversized_word() -> None:
    long_term = "pneumonoultramicroscopicsilicovolcanoconiosis"

    chunks = chunk_text(f"Topic {long_term} discussed", max_chars=20)

    assert long_term in chunks
    assert " ".join(" ".join(chunks).split()) == f"Topic {long_term} discussed"


def test_provider_failure_is_sanitized() -> None:
    response = create_client(FailingExtractor()).post(
        "/extract-topics",
        json={"text": "Deadlocks", "source": "VIDEO"},
    )

    assert response.status_code == 502
    assert response.json() == {"detail": "Topic extraction service failed."}
    assert "AIza-test-private" not in response.text


def test_missing_provider_credentials_are_reported_without_secrets() -> None:
    response = create_client().post(
        "/extract-topics",
        json={"text": "Deadlocks", "source": "VIDEO"},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "Topic extraction is not configured."}


def test_gemini_provider_uses_structured_json_response() -> None:
    expected = TopicExtractionResult(
        topics=[ExtractedTopic(name="Resource Allocation Graphs", confidence=0.88)]
    )
    client = FakeGeminiClient(expected.model_dump_json())
    provider = GeminiTopicModelProvider(
        api_key="test-key",
        model="gemini-3.5-flash-lite",
        client=client,
    )

    result = provider.extract_chunk("Resource allocation graphs", TopicSource.PDF)

    assert result == expected
    assert client.models.kwargs is not None
    assert client.models.kwargs["model"] == "gemini-3.5-flash-lite"
    config = client.models.kwargs["config"]
    assert isinstance(config, genai_types.GenerateContentConfig)
    assert config.response_mime_type == "application/json"
    assert config.response_json_schema == TopicExtractionResult.model_json_schema()
    assert config.response_schema is None
    assert config.temperature == 0
    assert config.tools is None
    assert config.tool_config is None
    assert config.automatic_function_calling is not None
    assert config.automatic_function_calling.disable is True


def test_gemini_provider_validates_returned_json_with_pydantic() -> None:
    client = FakeGeminiClient(
        json.dumps(
            {
                "topics": [
                    {"name": "Deadlocks", "confidence": 1.2},
                ]
            }
        )
    )
    provider = GeminiTopicModelProvider(
        api_key="test-key",
        model="gemini-3.5-flash-lite",
        client=client,
    )

    try:
        provider.extract_chunk("Deadlocks", TopicSource.VIDEO)
    except TopicProviderError as error:
        assert str(error) == "Topic model returned invalid structured output."
    else:
        raise AssertionError("Expected invalid confidence to fail Pydantic validation.")


def test_gemini_provider_sanitizes_provider_errors() -> None:
    client = FakeGeminiClient("", RuntimeError("upstream leaked AIza-private-key"))
    provider = GeminiTopicModelProvider(
        api_key="test-key",
        model="gemini-3.5-flash-lite",
        client=client,
    )

    try:
        provider.extract_chunk("Deadlocks", TopicSource.VIDEO)
    except TopicProviderError as error:
        assert str(error) == "Topic model request failed."
        assert "AIza-private-key" not in str(error)
    else:
        raise AssertionError("Expected the provider request to fail.")
