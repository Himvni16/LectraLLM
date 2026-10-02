# LectraLLM architecture

> Phase 8 status: the Phase 0–7 workflow is implemented and covered by final integration, failure, retry, boundary, and dashboard tests. Phase 8 adds hardening and deployment documentation only; it changes neither the database schema nor analysis behavior.

## High-level architecture

LectraLLM is an AI-powered lecture content comparison tool that analyzes a lecture video and its corresponding PDF, compares topic coverage, and produces percentage-based and graphical analysis. It is split into two application services backed by PostgreSQL:

- **Next.js web application:** the user-facing application and future product API. It owns relational data access through Prisma.
- **FastAPI AI service:** a separate internal service for compute-heavy document, media, embedding, and LLM workflows.
- **PostgreSQL:** the durable relational system of record, accessed at runtime through Prisma's Neon serverless driver adapter.

Keeping the future AI pipeline outside the web process allows its Python dependencies and compute profile to evolve independently without coupling them to the user-facing application.

## Next.js responsibilities

Implemented through Phase 7:

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
- Request separate topic extraction for the transcript (`VIDEO`) and PDF text (`PDF`).
- Atomically replace the current analysis's topics and advance it to `COMPARING`.
- Display both source-specific topic sets and confidence values.
- Send only stored topic IDs and names to the internal comparison endpoint.
- Validate one best-match result for every PDF topic.
- Atomically replace `TopicMatch` rows, persist the overall similarity score, and advance the analysis to `COMPLETED`.
- Derive dashboard-only counts and coverage from stored Phase 6 results.
- Display summary metrics, one match-distribution chart, topic progress bars, missing topics, and detailed comparisons for `COMPLETED` analyses.
- Preserve lecture/PDF topics and collapsible access to both source texts.

Phase 8 changes no Next.js product behavior. LectraLLM has no LMS, authentication, user, course, role, syllabus-management, student-account, notification, or administration scope.

## FastAPI responsibilities

Implemented through Phase 6; Phase 7 adds no FastAPI behavior:

- Expose `GET /health`.
- Centralize service configuration.
- Allow local requests from the Next.js development origins through CORS.
- Expose `POST /transcribe` for validated video media.
- Lazily load a configurable faster-whisper model and return text, language, duration, and segments.
- Delete temporary media after each request.
- Expose `POST /extract-pdf` for validated PDF media.
- Extract readable text page-by-page with PyMuPDF and apply light whitespace cleanup.
- Reject textless PDFs without attempting OCR and delete temporary PDFs after every request.
- Expose `POST /extract-topics` for validated text and a `VIDEO` or `PDF` source.
- Split long source text at paragraph/sentence boundaries and invoke a configurable Gemini structured-output model per chunk.
- Merge normalized duplicate topic names and return concise names with optional confidence values.
- Expose `POST /compare-topics` for stored VIDEO and PDF topic identifiers and names.
- Lazily load `sentence-transformers/all-MiniLM-L6-v2`, compute cosine similarities locally, and return one best match for every PDF topic.

OCR and unrelated AI workflows are **NOT IMPLEMENTED**. FastAPI does not access PostgreSQL or Prisma, and Phase 7 never calls it for dashboard rendering.

## Database role

PostgreSQL is the relational system of record for each video-and-PDF analysis, its extracted topics, best-match results, and overall similarity score. The hot-reload-safe Prisma singleton uses `PrismaNeon` with the pooled `DATABASE_URL` for application runtime queries. Prisma CLI, schema, and migration operations use the direct `DIRECT_URL` configured on the datasource. Neon can wake an idle endpoint through the serverless runtime connection, so development does not require a manual wake-up step. A bounded `P1001`-only retry remains at the existing Analysis database boundaries as a defense against transient first-connection failures.

Phase 1 defines exactly three application models: `Analysis`, `Topic`, and `TopicMatch`. The schema stores file metadata and paths, processing status, nullable future-extraction results, topic sources, and future semantic matches. It does not perform any processing.

Phase 2 reuses `Analysis` without a schema change. A successful upload records the sanitized original filenames, internal relative storage paths, and `UPLOADED` status. Extraction and score fields remain null.

Phase 3 also reuses the existing schema. During transcription, status changes from `UPLOADED` to `TRANSCRIBING`; on success, the full text is stored in `Analysis.transcriptText` and status advances to `EXTRACTING_PDF`. On failure, status becomes `FAILED` and the original video remains available for retry.

Phase 4 requires no schema change. During PDF extraction, status remains `EXTRACTING_PDF`; on success, cleaned text is stored in `Analysis.pdfText` and status advances to `EXTRACTING_TOPICS`. On failure, status becomes `FAILED` while the transcript and original files remain intact.

Phase 5 also requires no schema change. FastAPI extracts transcript and PDF topics independently. After both calls succeed, a single Prisma transaction changes status from `EXTRACTING_TOPICS` to `COMPARING`, deletes only existing `Topic` rows for that analysis, and inserts the replacement `VIDEO` and `PDF` rows. Provider failure changes status to `FAILED` without modifying source text or committing a partial topic set. No `TopicMatch` row or similarity score is created.

Phase 6 makes `TopicMatch.videoTopicId` nullable so `MISSING` PDF topics can be stored without fake VIDEO topics. For every PDF topic, one `TopicMatch` records its best VIDEO topic and cosine score, or a null VIDEO reference when the score is below `0.35`. A single transaction replaces prior matches, persists `average(best per-PDF similarity) * 100` in `Analysis.overallSimilarityScore`, and advances `COMPARING` to `COMPLETED`. Any failed comparison changes status to `FAILED` while preserving extracted topics for retry.

Phase 7 requires no schema change. The analysis page loads the already-stored score, topics, and best matches. A pure TypeScript helper derives match counts, topic rows, and coverage percentage without persisting dashboard-only values.

## Local upload storage

Development uploads are stored under `storage/videos/` and `storage/pdfs/`. Physical filenames are generated UUIDs rather than user-provided names, paths are constrained to the storage root, and the entire runtime directory is ignored by Git. If database creation fails after storage, the upload service attempts to remove both files.

This local filesystem implementation has no external object-storage provider. A production deployment must mount durable shared storage at `storage/`; an ephemeral filesystem is unsafe because the database stores paths to these files. Independently scaled instances are also unsafe unless every instance can access the same persistent volume.

## Transcription boundary

Browser requests identify only an analysis ID. Next.js loads that record, resolves and verifies its relative video path within `storage/videos/`, and sends the media bytes to FastAPI. Clients cannot submit filesystem paths to either transcription endpoint.

FastAPI streams the request to an operating-system temporary file, invokes a lazily loaded faster-whisper engine in a worker thread, returns structured transcription data, and removes the temporary file in all outcomes. PyAV supplies bundled FFmpeg libraries, so this path has no separate system FFmpeg dependency.

## PDF extraction boundary

Browser requests again identify only an analysis ID. Next.js loads the associated record, requires a completed transcript, constrains the relative PDF path to `storage/pdfs/`, and sends the PDF bytes to FastAPI. Neither browser endpoint accepts a filesystem path.

FastAPI validates the PDF filename, MIME type, size, and content; streams it to an operating-system temporary file; and invokes PyMuPDF in a worker thread. Text is read page-by-page in sorted reading order, empty pages are ignored, and only conservative whitespace cleanup is applied. Temporary files are removed on success and failure. Phase 4 handles text-based PDFs only and deliberately includes no OCR.

## Topic extraction boundary

Next.js loads both source texts from the selected `Analysis`; browsers submit only the analysis ID. It calls FastAPI twice, once with source `VIDEO` and once with source `PDF`. Provider credentials remain exclusively in `ai-service/.env`.

FastAPI isolates the Gemini Developer API behind a small provider protocol and uses the official Google Gen AI Python SDK to request a Pydantic-backed structured JSON response. The configured default is the free-tier `gemini-3.5-flash-lite`, and provider responses are never persisted until both source calls succeed. Long inputs are chunked deterministically, and normalized duplicate names are merged without embeddings. Next.js performs the final replace-and-transition operation in one transaction.

## Topic comparison boundary

Browser requests identify only an analysis ID. Next.js loads the stored VIDEO and PDF topics, then sends their stable IDs and names to FastAPI. FastAPI uses the configurable local `sentence-transformers/all-MiniLM-L6-v2` model and never calls Gemini, Prisma, or PostgreSQL for comparison.

The PDF is the reference source: every PDF topic receives exactly one result containing its highest cosine similarity against the VIDEO set. Scores are clamped to `0..1` and classified with centralized thresholds: `STRONG >= 0.75`, `PARTIAL >= 0.55`, `WEAK >= 0.35`, and `MISSING < 0.35`. Missing results retain their actual score but use a null VIDEO relation. Next.js validates IDs, cardinality, scores, and classifications before atomically persisting results.

## Dashboard boundary

The dashboard exists only in the Next.js presentation layer and renders only when an analysis is `COMPLETED`. Its pure helper calculates `coverage = non-MISSING PDF topics / total PDF topics * 100`, counts every `MatchType`, and maps stored similarities to display percentages while preserving database order. Recharts renders one match-distribution bar chart; topic-level similarity uses accessible progress bars. No dashboard value is accepted from the browser or written back to PostgreSQL.

## Implemented data flow

The flow through the Phase 7 report is implemented:

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

The web application accepts and records the video/PDF input, transcribes the lecture, extracts readable PDF text, stores separate VIDEO/PDF topics, persists Phase 6 best-match similarities, and derives the Phase 7 report from those results. Phase 8 hardening does not add another processing step. Production topology and operational requirements are documented in [deployment.md](deployment.md).
