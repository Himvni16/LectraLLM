# LectraLLM architecture

> Phase 0 status: foundation only. Every processing and analysis stage described as future work below is **NOT IMPLEMENTED**.

## High-level architecture

LectraLLM is split into two application services backed by PostgreSQL:

- **Next.js web application:** the user-facing application and future product API. It owns relational data access through Prisma.
- **FastAPI AI service:** a separate internal service reserved for future compute-heavy document, media, embedding, and LLM workflows.
- **PostgreSQL:** the durable relational system of record, accessed by the web application through Prisma.

Keeping the future AI pipeline outside the web process allows its Python dependencies and compute profile to evolve independently without coupling them to the user-facing application.

## Next.js responsibilities

Implemented in Phase 0:

- Render the minimal LectraLLM application shell.
- Validate required server-side environment configuration.
- Provide a safe proxy health endpoint for the FastAPI service.
- Provide the Prisma client boundary for future data access.

Authentication, uploads, dashboard features, business workflows, and application database models are **NOT IMPLEMENTED**.

## FastAPI responsibilities

Implemented in Phase 0:

- Expose `GET /health`.
- Centralize service configuration.
- Allow local requests from the Next.js development origins through CORS.

Transcription, audio extraction, PDF parsing, syllabus parsing, embeddings, model calls, topic analysis, and background jobs are **NOT IMPLEMENTED**.

## Database role

PostgreSQL is planned as the relational system of record for users, lectures, source-document metadata, processing state, and analysis results. Prisma will be the web application's database client and migration tool.

Phase 0 only configures the PostgreSQL datasource and Prisma Client generator. There are no application models or migrations yet, and no database operations are run.

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
PDF/Syllabus Processing
```

The web application will eventually coordinate input and present results. The AI service will execute media and semantic processing. PostgreSQL will store durable metadata, workflow state, and report data. Exact contracts and schemas are deferred until later phases.
