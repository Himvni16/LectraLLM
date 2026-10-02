# LectraLLM architecture

> Phase 4 status: local video transcription and text-based PDF extraction are implemented. Topic extraction and every later analysis stage described below remain **NOT IMPLEMENTED**.

## High-level architecture

LectraLLM is an AI-powered lecture content comparison tool that analyzes a lecture video and its corresponding PDF, compares topic coverage, and produces percentage-based and graphical analysis. It is split into two application services backed by PostgreSQL:

- **Next.js web application:** the user-facing application and future product API. It owns relational data access through Prisma.
- **FastAPI AI service:** a separate internal service reserved for future compute-heavy document, media, embedding, and LLM workflows.
- **PostgreSQL:** the durable relational system of record, accessed at runtime through Prisma's Neon serverless driver adapter.

Keeping the future AI pipeline outside the web process allows its Python dependencies and compute profile to evolve independently without coupling them to the user-facing application.

## Next.js responsibilities

Implemented through Phase 4:

- Render the minimal LectraLLM application shell.
- Validate required server-side environment configuration.
- Provide a safe proxy health endpoint for the FastAPI service.
- Provide the Prisma client boundary for future data access.
- Render the `/upload` workflow and validate one video plus one PDF.
- Store validated files locally and create an `UPLOADED` analysis record.
- Resolve the database-controlled stored video and request transcription from FastAPI.
- Persist the final transcript and advance the workflow to `EXTRACTING_PDF`.
- Resolve the database-controlled stored PDF and request text extraction from FastAPI.
- Persist the extracted PDF text and advance the workflow to `EXTRACTING_TOPICS`.

Topic analysis, semantic comparison, and graphical results are **NOT IMPLEMENTED**. LectraLLM has no LMS, authentication, user, course, role, or syllabus-management scope.

## FastAPI responsibilities

Implemented through Phase 4:

- Expose `GET /health`.
- Centralize service configuration.
- Allow local requests from the Next.js development origins through CORS.
- Expose `POST /transcribe` for validated video media.
- Lazily load a configurable faster-whisper model and return text, language, duration, and segments.
- Delete temporary media after each request.
- Expose `POST /extract-pdf` for validated PDF media.
- Extract readable text page-by-page with PyMuPDF and apply light whitespace cleanup.
- Reject textless PDFs without attempting OCR and delete temporary PDFs after every request.

OCR, embeddings, model calls beyond local speech-to-text, topic analysis, and semantic comparison are **NOT IMPLEMENTED**.

## Database role

PostgreSQL is the relational system of record for each video-and-PDF analysis, its future extracted topics, and future topic-match results. The hot-reload-safe Prisma singleton uses `PrismaNeon` with the pooled `DATABASE_URL` for application runtime queries. Prisma CLI, schema, and migration operations use the direct `DIRECT_URL` configured on the datasource. Neon can wake an idle endpoint through the serverless runtime connection, so development does not require a manual wake-up step. A bounded `P1001`-only retry remains at the existing Analysis database boundaries as a defense against transient first-connection failures.

Phase 1 defines exactly three application models: `Analysis`, `Topic`, and `TopicMatch`. The schema stores file metadata and paths, processing status, nullable future-extraction results, topic sources, and future semantic matches. It does not perform any processing.

Phase 2 reuses `Analysis` without a schema change. A successful upload records the sanitized original filenames, internal relative storage paths, and `UPLOADED` status. Extraction and score fields remain null.

Phase 3 also reuses the existing schema. During transcription, status changes from `UPLOADED` to `TRANSCRIBING`; on success, the full text is stored in `Analysis.transcriptText` and status advances to `EXTRACTING_PDF`. On failure, status becomes `FAILED` and the original video remains available for retry.

Phase 4 requires no schema change. During PDF extraction, status remains `EXTRACTING_PDF`; on success, cleaned text is stored in `Analysis.pdfText` and status advances to `EXTRACTING_TOPICS`. On failure, status becomes `FAILED` while the transcript and original files remain intact.

## Local upload storage

Development uploads are stored under `storage/videos/` and `storage/pdfs/`. Physical filenames are generated UUIDs rather than user-provided names, paths are constrained to the storage root, and the entire runtime directory is ignored by Git. If database creation fails after storage, the upload service attempts to remove both files.

This local filesystem implementation is development-only. No external or production storage provider is configured in Phase 2.

## Transcription boundary

Browser requests identify only an analysis ID. Next.js loads that record, resolves and verifies its relative video path within `storage/videos/`, and sends the media bytes to FastAPI. Clients cannot submit filesystem paths to either transcription endpoint.

FastAPI streams the request to an operating-system temporary file, invokes a lazily loaded faster-whisper engine in a worker thread, returns structured transcription data, and removes the temporary file in all outcomes. PyAV supplies bundled FFmpeg libraries, so this path has no separate system FFmpeg dependency.

## PDF extraction boundary

Browser requests again identify only an analysis ID. Next.js loads the associated record, requires a completed transcript, constrains the relative PDF path to `storage/pdfs/`, and sends the PDF bytes to FastAPI. Neither browser endpoint accepts a filesystem path.

FastAPI validates the PDF filename, MIME type, size, and content; streams it to an operating-system temporary file; and invokes PyMuPDF in a worker thread. Text is read page-by-page in sorted reading order, empty pages are ignored, and only conservative whitespace cleanup is applied. Temporary files are removed on success and failure. Phase 4 handles text-based PDFs only and deliberately includes no OCR.

## Planned future data flow

The following flow is architectural direction only and is **NOT IMPLEMENTED**:

```text
Lecture Video
     ↓
Audio Extraction
     ↓
Transcription
     ↓
Topic Analysis
     ↘
      Semantic Comparison → Coverage Engine → Report
     ↗
PDF Processing
```

The web application accepts and records the video/PDF input, transcribes the lecture, and extracts readable PDF text through the AI service. Phase 5 will add topic extraction. Later phases will add semantic comparison and reporting, while PostgreSQL stores durable comparison metadata and results.
