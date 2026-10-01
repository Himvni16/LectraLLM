# LectraLLM

LectraLLM is an AI-powered lecture content validation and analysis platform. Professors will eventually be able to compare lecture content with supporting PDFs and optional syllabi.

## Current phase

This repository contains **Phase 0 — Project Foundation only**. It includes the application shell, service boundaries, configuration, database client setup, health integration, tests, and developer documentation.

Authentication, file uploads, transcription, LLM calls, embeddings, topic analysis, coverage reports, and dashboards are **not implemented**.

## Architecture overview

- **Next.js + React + TypeScript + Tailwind CSS:** primary web application at the repository root.
- **PostgreSQL + Prisma:** planned relational persistence; Phase 0 has no application models or migrations.
- **FastAPI + Python:** isolated service under `ai-service/` for future media, document, and AI processing.

See [docs/architecture.md](docs/architecture.md) for responsibilities and the planned future data flow.

## Prerequisites

- Node.js 20.19 or newer (Node.js 22 LTS is recommended)
- npm 10 or newer
- Python 3.12 (Python 3.11 is also suitable)
- PostgreSQL 15 or newer
- Windows 11 PowerShell, or an equivalent terminal

## Web setup

From the repository root:

```powershell
npm install
Copy-Item .env.example .env.local
npm run prisma:generate
npm run dev
```

The web application is available at `http://localhost:3000`.

## Environment setup

The web app reads `.env.local`, which is intentionally ignored by Git.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection URL used by Prisma |
| `AI_SERVICE_URL` | Yes | Base URL for the FastAPI service, normally `http://127.0.0.1:8000` |

Copy `.env.example` and adjust credentials. Required server values are validated when the Next.js server starts and produce an actionable error when absent.

The AI service optionally reads `ai-service/.env`. Its `AI_CORS_ORIGINS` value is a comma-separated list and defaults to the two common local Next.js origins.

## Database setup

1. Start PostgreSQL locally.
2. Create an empty database named `lectrallm`.
3. Set `DATABASE_URL` in `.env.local` to your real local connection string.
4. Run `npm run prisma:generate`.

Phase 0 does not include models or migrations. Do not run `prisma migrate` yet; there is no application schema to apply.

## AI service setup

From the repository root:

```powershell
Set-Location ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
python -m uvicorn app.main:app --reload --port 8000
```

The service is available at `http://127.0.0.1:8000`. Verify it at `http://127.0.0.1:8000/health`.

## Run both services

Use two PowerShell windows:

```powershell
# Window 1, repository root
npm run dev
```

```powershell
# Window 2, repository root
Set-Location ai-service
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --reload --port 8000
```

With both running, the web-side proxy health endpoint is `http://localhost:3000/api/ai-health`.

## Quality checks and tests

Run web checks from the repository root:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Run AI service tests from `ai-service/` with the virtual environment active:

```powershell
python -m pytest
python -c "from app.main import app; print(app.title)"
```

## npm scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Create a production build |
| `npm start` | Serve a completed production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run strict TypeScript checking |
| `npm test` | Run Vitest once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run prisma:generate` | Generate Prisma Client |

## Planned future phases

Future work may introduce authentication, lecture/PDF/syllabus ingestion, background processing, transcription, document parsing, topic extraction, semantic comparison, coverage scoring, and reporting dashboards. These capabilities will be designed and implemented in later phases; none are included in Phase 0.
