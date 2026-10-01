# LectraLLM architecture

> Phase 2 status: local-development video and PDF upload is implemented. Every media-processing and analysis stage described as future work below is **NOT IMPLEMENTED**.

## High-level architecture

LectraLLM is an AI-powered lecture content comparison tool that analyzes a lecture video and its corresponding PDF, compares topic coverage, and produces percentage-based and graphical analysis. It is split into two application services backed by PostgreSQL:

- **Next.js web application:** the user-facing application and future product API. It owns relational data access through Prisma.
- **FastAPI AI service:** a separate internal service reserved for future compute-heavy document, media, embedding, and LLM workflows.
- **PostgreSQL:** the durable relational system of record, accessed by the web application through Prisma.

Keeping the future AI pipeline outside the web process allows its Python dependencies and compute profile to evolve independently without coupling them to the user-facing application.

## Next.js responsibilities

Implemented through Phase 2:

- Render the minimal LectraLLM application shell.
- Validate required server-side environment configuration.
- Provide a safe proxy health endpoint for the FastAPI service.
- Provide the Prisma client boundary for future data access.
- Render the `/upload` workflow and validate one video plus one PDF.
- Store validated files locally and create an `UPLOADED` analysis record.

Transcription, document extraction, analysis workflows, and graphical results are **NOT IMPLEMENTED**. LectraLLM has no LMS, authentication, user, course, role, or syllabus-management scope.

## FastAPI responsibilities

Implemented in Phase 0:

- Expose `GET /health`.
- Centralize service configuration.
- Allow local requests from the Next.js development origins through CORS.

Transcription, audio extraction, PDF parsing, embeddings, model calls, topic analysis, and semantic comparison are **NOT IMPLEMENTED**.

## Database role

PostgreSQL is the relational system of record for each video-and-PDF analysis, its future extracted topics, and future topic-match results. Prisma is the web application's database client and migration tool.

Phase 1 defines exactly three application models: `Analysis`, `Topic`, and `TopicMatch`. The schema stores file metadata and paths, processing status, nullable future-extraction results, topic sources, and future semantic matches. It does not perform any processing.

Phase 2 reuses `Analysis` without a schema change. A successful upload records the sanitized original filenames, internal relative storage paths, and `UPLOADED` status. Extraction and score fields remain null.

## Local upload storage

Development uploads are stored under `storage/videos/` and `storage/pdfs/`. Physical filenames are generated UUIDs rather than user-provided names, paths are constrained to the storage root, and the entire runtime directory is ignored by Git. If database creation fails after storage, the upload service attempts to remove both files.

This local filesystem implementation is development-only. No external or production storage provider is configured in Phase 2.

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

The web application now accepts and records the video/PDF input. Phase 3 will handle lecture transcription, and Phase 4 will handle PDF text extraction. The AI service will later execute media, document, and semantic processing, while PostgreSQL stores durable comparison metadata and results. Those processing workflows remain deferred.
