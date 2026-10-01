from __future__ import annotations

from threading import Lock
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field


class TranscriptionSegment(BaseModel):
    start: float
    end: float
    text: str


class TranscriptionResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    text: str
    language: str | None
    duration_seconds: float | None = Field(serialization_alias="durationSeconds")
    segments: list[TranscriptionSegment]
    model: str


class Transcriber(Protocol):
    def transcribe(self, media_path: str) -> TranscriptionResult: ...


class FasterWhisperTranscriber:
    """Lazy, thread-safe faster-whisper model adapter."""

    def __init__(self, model_name: str, device: str, compute_type: str) -> None:
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type
        self._model: object | None = None
        self._model_lock = Lock()

    def _get_model(self) -> object:
        if self._model is None:
            with self._model_lock:
                if self._model is None:
                    from faster_whisper import WhisperModel

                    self._model = WhisperModel(
                        self.model_name,
                        device=self.device,
                        compute_type=self.compute_type,
                    )

        return self._model

    def transcribe(self, media_path: str) -> TranscriptionResult:
        model = self._get_model()
        raw_segments, info = model.transcribe(  # type: ignore[attr-defined]
            media_path,
            beam_size=5,
            vad_filter=True,
        )
        segments = [
            TranscriptionSegment(
                start=float(segment.start),
                end=float(segment.end),
                text=segment.text.strip(),
            )
            for segment in raw_segments
            if segment.text.strip()
        ]

        return TranscriptionResult(
            text=" ".join(segment.text for segment in segments).strip(),
            language=getattr(info, "language", None),
            duration_seconds=getattr(info, "duration", None),
            segments=segments,
            model=self.model_name,
        )
