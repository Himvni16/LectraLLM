from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.transcription import TranscriptionResult, TranscriptionSegment


class SuccessfulTranscriber:
    def __init__(self) -> None:
        self.media_path: str | None = None

    def transcribe(self, media_path: str) -> TranscriptionResult:
        self.media_path = media_path
        assert Path(media_path).is_file()
        return TranscriptionResult(
            text="Today we will discuss deadlocks.",
            language="en",
            duration_seconds=6.2,
            segments=[
                TranscriptionSegment(
                    start=0.0,
                    end=6.2,
                    text="Today we will discuss deadlocks.",
                )
            ],
            model="base",
        )


class FailingTranscriber:
    def __init__(self) -> None:
        self.media_path: str | None = None

    def transcribe(self, media_path: str) -> TranscriptionResult:
        self.media_path = media_path
        assert Path(media_path).is_file()
        raise RuntimeError(f"decoder failed for {media_path}")


def test_transcription_requires_media() -> None:
    client = TestClient(
        create_app(settings=Settings(_env_file=None), transcriber=SuccessfulTranscriber())
    )

    response = client.post("/transcribe")

    assert response.status_code == 422


def test_transcription_rejects_invalid_media_type() -> None:
    transcriber = SuccessfulTranscriber()
    client = TestClient(
        create_app(settings=Settings(_env_file=None), transcriber=transcriber)
    )

    response = client.post(
        "/transcribe",
        files={"media": ("notes.pdf", b"not-a-video", "application/pdf")},
    )

    assert response.status_code == 415
    assert response.json() == {
        "detail": "Media must be an MP4, MOV, or WebM video."
    }
    assert transcriber.media_path is None


def test_transcription_returns_structured_response_and_cleans_temp_file() -> None:
    transcriber = SuccessfulTranscriber()
    client = TestClient(
        create_app(settings=Settings(_env_file=None), transcriber=transcriber)
    )

    response = client.post(
        "/transcribe",
        files={"media": ("lecture.mp4", b"mock-video", "video/mp4")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "text": "Today we will discuss deadlocks.",
        "language": "en",
        "durationSeconds": 6.2,
        "segments": [
            {
                "start": 0.0,
                "end": 6.2,
                "text": "Today we will discuss deadlocks.",
            }
        ],
        "model": "base",
    }
    assert transcriber.media_path is not None
    assert not Path(transcriber.media_path).exists()


def test_transcription_sanitizes_engine_failures_and_cleans_temp_file() -> None:
    transcriber = FailingTranscriber()
    client = TestClient(
        create_app(settings=Settings(_env_file=None), transcriber=transcriber)
    )

    response = client.post(
        "/transcribe",
        files={"media": ("lecture.mp4", b"mock-video", "video/mp4")},
    )

    assert response.status_code == 500
    assert response.json() == {"detail": "The lecture could not be transcribed."}
    assert transcriber.media_path is not None
    assert transcriber.media_path not in response.text
    assert not Path(transcriber.media_path).exists()
