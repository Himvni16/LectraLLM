# LectraLLM

LectraLLM is an AI-powered lecture content comparison tool that analyzes a lecture video and its corresponding PDF, compares topic coverage, and produces percentage-based and graphical analysis.

## Current phase

**Phase 3 — Video Transcription is complete.** The repository includes the Phase 0 foundation, the Phase 1 minimal relational schema, the Phase 2 upload workflow, and local lecture transcription through the FastAPI AI service.

PDF extraction, topic extraction, semantic comparison, percentages, graphs, and final analysis results are **not implemented**. LectraLLM is not an LMS and does not include users, courses, roles, or syllabus management.

## Architecture overview

- **Next.js + React + TypeScript + Tailwind CSS:** primary web application at the repository root.
- **PostgreSQL + Prisma:** relational persistence for analyses, extracted topics, and future topic-match results.
- **FastAPI + Python:** isolated service under `ai-service/` that performs local faster-whisper transcription and will later own document and AI processing.

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
| `VIDEO_MAX_SIZE_MB` | No | Lecture video limit in MiB; defaults to `250` |
| `PDF_MAX_SIZE_MB` | No | Lecture PDF limit in MiB; defaults to `25` |
| `AI_TRANSCRIPTION_TIMEOUT_SECONDS` | No | Web-to-AI transcription timeout; defaults to `1800` seconds |

Copy `.env.example` and adjust credentials. Required server values are validated when the Next.js server starts and produce an actionable error when absent.

The AI service optionally reads `ai-service/.env`. Its `AI_CORS_ORIGINS` value is a comma-separated list and defaults to the two common local Next.js origins.

## Database setup

1. Start PostgreSQL locally.
2. Create an empty database named `lectrallm`.
3. Set `DATABASE_URL` in `.env.local` to your real local connection string.
4. Apply the Phase 1 migration with `npx prisma migrate dev`.
5. Run `npm run prisma:generate`.

The migration creates only `Analysis`, `Topic`, and `TopicMatch`, plus their supporting enums and indexes. For optional development sample data, run `npm run prisma:seed` after applying the migration.

## Upload workflow

Open `http://localhost:3000/upload`, select one lecture video and one corresponding PDF, and submit them together. The server validates both files, stores them under the local `storage/` directory, and creates one `Analysis` record with status `UPLOADED`.

Supported video formats:

- MP4 (`.mp4`, `video/mp4`)
- QuickTime MOV (`.mov`, common QuickTime MIME types)
- WebM (`.webm`, `video/webm`)

The document must be a `.pdf` with the `application/pdf` MIME type when the browser supplies one. Empty, missing, duplicate, invalid, or oversized files are rejected server-side with readable errors.

Local development storage is organized as follows:

```text
storage/
├── videos/
└── pdfs/
```

Physical filenames are collision-safe generated UUIDs; original sanitized filenames are retained in the database. The runtime directory is ignored by Git. Local filesystem storage is development-only and is not intended for distributed or production deployment.

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

The AI service supports these optional values in `ai-service/.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WHISPER_MODEL` | `base` | faster-whisper model name or local model path |
| `WHISPER_DEVICE` | `cpu` | CTranslate2 execution device |
| `WHISPER_COMPUTE_TYPE` | `int8` | CTranslate2 compute type |
| `TRANSCRIPTION_MAX_SIZE_MB` | `250` | Maximum media size accepted by `/transcribe` |

The model is initialized lazily on the first real transcription request. When a model name such as `base` is used, faster-whisper downloads its model files to the standard Hugging Face cache on first use. CPU with `int8` is the development default; no GPU is required.

faster-whisper decodes media through PyAV, whose wheel bundles the required FFmpeg libraries. A separate system FFmpeg installation is therefore not required for this workflow.

## Transcription workflow

After a successful upload, open `/analyses/<analysis-id>` or follow the **Open analysis** link. Select **Transcribe lecture** to run this flow:

```text
UPLOADED → TRANSCRIBING → EXTRACTING_PDF
```

Next.js resolves only the stored video attached to the selected `Analysis`, uploads its bytes to FastAPI `POST /transcribe`, and stores the returned full text in `Analysis.transcriptText`. FastAPI uses a temporary media file and removes it after success or failure. The original uploaded video remains unchanged.

If transcription fails, the analysis becomes `FAILED` and can be retried from the analysis page. Browser responses do not include internal storage or temporary paths.

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
| `npm run prisma:seed` | Seed one repeatable development analysis |

## Planned future phases

- **Phase 4:** extract text from the corresponding PDF.
- Later phases: topic extraction, semantic comparison, topic-wise coverage percentages, graphs, and the final analysis interface.

None of those Phase 4+ processing or analysis capabilities is implemented in Phase 3.
