# LectraLLM architecture

> Phase 1 status: the minimal relational data structure is implemented. Every processing and analysis stage described as future work below is **NOT IMPLEMENTED**.

## High-level architecture

LectraLLM is an AI-powered lecture content comparison tool that analyzes a lecture video and its corresponding PDF, compares topic coverage, and produces percentage-based and graphical analysis. It is split into two application services backed by PostgreSQL:

- **Next.js web application:** the user-facing application and future product API. It owns relational data access through Prisma.
- **FastAPI AI service:** a separate internal service reserved for future compute-heavy document, media, embedding, and LLM workflows.
- **PostgreSQL:** the durable relational system of record, accessed by the web application through Prisma.

Keeping the future AI pipeline outside the web process allows its Python dependencies and compute profile to evolve independently without coupling them to the user-facing application.

## Next.js responsibilities

Implemented through Phase 1:

- Render the minimal LectraLLM application shell.
- Validate required server-side environment configuration.
- Provide a safe proxy health endpoint for the FastAPI service.
- Provide the Prisma client boundary for future data access.

Uploads, analysis workflows, and graphical results are **NOT IMPLEMENTED**. LectraLLM has no LMS, authentication, user, course, role, or syllabus-management scope.

## FastAPI responsibilities

Implemented in Phase 0:

- Expose `GET /health`.
- Centralize service configuration.
- Allow local requests from the Next.js development origins through CORS.

Transcription, audio extraction, PDF parsing, embeddings, model calls, topic analysis, and semantic comparison are **NOT IMPLEMENTED**.

## Database role

PostgreSQL is the relational system of record for each video-and-PDF analysis, its future extracted topics, and future topic-match results. Prisma is the web application's database client and migration tool.

Phase 1 defines exactly three application models: `Analysis`, `Topic`, and `TopicMatch`. The schema stores file metadata and paths, processing status, nullable future-extraction results, topic sources, and future semantic matches. It does not perform any processing.

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

The web application will eventually coordinate the video/PDF input and present percentage-based and graphical results. The AI service will execute media, document, and semantic processing. PostgreSQL will store durable comparison metadata and results. Those workflows are deferred to later phases.
