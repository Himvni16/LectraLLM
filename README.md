# LectraLLM

LectraLLM is an AI-powered lecture content comparison tool that analyzes a lecture video and its corresponding PDF, compares topic coverage, and produces percentage-based and graphical analysis.

## Current phase

**Phase 7 — Analysis Dashboard is complete.** The repository includes the Phase 0 foundation, the relational and upload workflows, local lecture transcription, text-based PDF extraction, separate LLM-based topic extraction, local embedding-based comparison, and a completed-analysis report derived from stored comparison results.

Phase 8 deployment work is **not implemented**. LectraLLM is not an LMS and does not include users, courses, roles, syllabus management, student accounts, notifications, or administration features.

## Architecture overview

- **Next.js + React + TypeScript + Tailwind CSS:** primary web application and Recharts-backed analysis dashboard at the repository root.
- **PostgreSQL + Prisma:** relational persistence for analyses, extracted topics, best-match results, and overall similarity. Runtime queries use Prisma's Neon serverless adapter.
- **FastAPI + Python:** isolated service under `ai-service/` that performs local faster-whisper transcription, PyMuPDF text extraction, Gemini-backed structured topic extraction, and local sentence-transformer comparison.

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
| `DATABASE_URL` | Yes | Pooled PostgreSQL URL used by application/runtime Prisma queries |
| `DIRECT_URL` | Yes for Prisma CLI | Direct PostgreSQL URL used by migrations and administrative commands |
| `AI_SERVICE_URL` | Yes | Base URL for the FastAPI service, normally `http://127.0.0.1:8000` |
| `VIDEO_MAX_SIZE_MB` | No | Lecture video limit in MiB; defaults to `250` |
| `PDF_MAX_SIZE_MB` | No | Lecture PDF limit in MiB; defaults to `25` |
| `AI_TRANSCRIPTION_TIMEOUT_SECONDS` | No | Web-to-AI processing timeout currently shared by transcription and PDF extraction; defaults to `1800` seconds |

Copy `.env.example` and adjust credentials. Required server values are validated when the Next.js server starts and produce an actionable error when absent.

The AI service optionally reads `ai-service/.env`. Its `AI_CORS_ORIGINS` value is a comma-separated list and defaults to the two common local Next.js origins.

## Database setup

1. Provision a PostgreSQL database, locally or through Neon.
2. Set `DATABASE_URL` in `.env.local` to the pooled runtime URL. Neon pooled hostnames normally include `-pooler`. The singleton application client passes this URL to `PrismaNeon`, which connects through Neon's serverless driver rather than Prisma's default TCP query-engine transport.
3. Set `DIRECT_URL` to the corresponding direct, non-pooler URL. Prisma CLI, schema validation, and migration operations continue to use this direct connection through the Prisma datasource configuration.
4. Apply the checked-in migrations with `npx prisma migrate dev`.
5. Run `npm run prisma:generate`.

The migration creates only `Analysis`, `Topic`, and `TopicMatch`, plus their supporting enums and indexes. For optional development sample data, run `npm run prisma:seed` after applying the migration.

### Neon idle wake-up behavior

Neon may auto-suspend an idle compute endpoint. Runtime Prisma queries use the Neon serverless driver adapter, so LectraLLM can connect to and wake the endpoint automatically; no manual Neon wake-up step is required. The first request after an idle period can still take slightly longer or initially return Prisma `P1001` while the endpoint becomes ready.

LectraLLM retains a defensive retry around application database boundaries, including Analysis creation, loading, and transcription/PDF-extraction state updates. It retries only Prisma `P1001`, including `P1001` errors mapped from adapter connection failures. The policy is bounded to three total attempts with a 1.5-second delay between attempts. Other Prisma errors and application validation errors are not retried. Retry logs contain only the operation name, error code, and attempt metadata; database URLs and credentials are never returned to the browser.

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

The AI service reads these values from `ai-service/.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WHISPER_MODEL` | `base` | faster-whisper model name or local model path |
| `WHISPER_DEVICE` | `cpu` | CTranslate2 execution device |
| `WHISPER_COMPUTE_TYPE` | `int8` | CTranslate2 compute type |
| `TRANSCRIPTION_MAX_SIZE_MB` | `250` | Maximum media size accepted by `/transcribe` |
| `PDF_MAX_SIZE_MB` | `25` | Maximum PDF size accepted by `/extract-pdf`; keep aligned with the web value |
| `TOPIC_PROVIDER` | `gemini` | Topic model provider; Phase 5 uses the Gemini Developer API |
| `GEMINI_API_KEY` | No default | Required only when running topic extraction; keep this server-side |
| `GEMINI_TOPIC_MODEL` | `gemini-3.5-flash-lite` | Free-tier structured-output model used for topic extraction |
| `TOPIC_CHUNK_CHARS` | `12000` | Maximum source characters processed in one model request |
| `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | Local sentence-transformer model used for Phase 6 comparison |

The transcription and embedding models are initialized lazily. On their first real use, faster-whisper and sentence-transformers download configured model files to the standard Hugging Face cache. CPU with `int8` is the transcription development default; no GPU is required. The first comparison can therefore take longer while `all-MiniLM-L6-v2` is downloaded and loaded.

faster-whisper decodes media through PyAV, whose wheel bundles the required FFmpeg libraries. A separate system FFmpeg installation is therefore not required for this workflow.

## Transcription workflow

After a successful upload, open `/analyses/<analysis-id>` or follow the **Open analysis** link. Select **Transcribe lecture** to run this flow:

```text
UPLOADED → TRANSCRIBING → EXTRACTING_PDF
```

Next.js resolves only the stored video attached to the selected `Analysis`, uploads its bytes to FastAPI `POST /transcribe`, and stores the returned full text in `Analysis.transcriptText`. FastAPI uses a temporary media file and removes it after success or failure. The original uploaded video remains unchanged.

If transcription fails, the analysis becomes `FAILED` and can be retried from the analysis page. Browser responses do not include internal storage or temporary paths.

## PDF text extraction workflow

After transcription succeeds, the analysis page offers **Extract PDF text** and runs:

```text
EXTRACTING_PDF → EXTRACTING_TOPICS
```

Next.js resolves only the stored PDF attached to the selected `Analysis`, verifies that its path remains under `storage/pdfs/`, and uploads its bytes to FastAPI `POST /extract-pdf`. FastAPI streams the upload to a temporary file, uses PyMuPDF to extract text page-by-page, applies conservative whitespace cleanup, and removes the temporary file in every outcome. The final text is stored in `Analysis.pdfText`; `Analysis.transcriptText` and both original uploads remain unchanged.

Phase 4 supports text-based PDFs only. Scanned or image-only PDFs return `No extractable text found in PDF.` OCR is intentionally not installed or attempted. Failed extraction moves the analysis to `FAILED` and can be retried when a completed transcript is present.

## Topic extraction workflow

For an analysis at `EXTRACTING_TOPICS`, select **Extract topics** on the analysis page. Next.js sends the transcript and PDF text to FastAPI separately as `VIDEO` and `PDF` sources. FastAPI uses the official Google Gen AI Python SDK with Gemini Structured Outputs and the configured `GEMINI_TOPIC_MODEL`; the API key remains inside the Python service and is never returned to Next.js or the browser. The default `gemini-3.5-flash-lite` model is available on the Gemini Developer API free tier and is intended for low-cost document parsing and simple structured extraction.

Long source text is split deterministically at paragraph and sentence boundaries where practical, without splitting ordinary words. Each chunk is processed independently, then exact normalized duplicates are merged while retaining the highest confidence. The source text is not sent to an embedding service during extraction.

After both source extractions succeed, one database transaction replaces only the current analysis's previous topics, stores lecture topics as `VIDEO`, stores PDF topics/subtopics as `PDF`, and advances the analysis to `COMPARING`. If either extraction fails, no partial replacement is committed, both source texts are preserved, and status becomes `FAILED` for a safe retry.

The existing `Topic` model is sufficient, so Phase 5 adds no schema migration.

## Topic comparison workflow

For an analysis at `COMPARING`, select **Compare Lecture & PDF**. Next.js loads the stored topic IDs and names and calls FastAPI `POST /compare-topics`; the browser never supplies similarity values. FastAPI uses the local `sentence-transformers/all-MiniLM-L6-v2` model to embed topic names and calculate cosine similarity. Gemini is not called during comparison, and FastAPI has no database access.

PDF topics are the reference set. For every PDF topic, FastAPI returns only its highest-scoring VIDEO topic. Similarities are clamped to `0..1` and classified using `STRONG >= 0.75`, `PARTIAL >= 0.55`, `WEAK >= 0.35`, and `MISSING < 0.35`. A missing result keeps its actual low score but stores no VIDEO topic ID.

Next.js validates that the response contains exactly one correctly classified result per PDF topic. A single Prisma transaction replaces old `TopicMatch` rows, stores the new matches, sets `overallSimilarityScore` to `average(per-PDF best similarities) * 100`, and changes status to `COMPLETED`. Failures change the status to `FAILED` and can be retried with the existing topics intact. The Phase 6 migration makes only `TopicMatch.videoTopicId` nullable so missing coverage is represented without fake topics.

## Analysis dashboard

Completed analyses render a dedicated report on `/analyses/<analysis-id>`. The dashboard reads only the existing `Analysis`, `Topic`, and `TopicMatch` values already loaded by the page; it makes no Gemini, embedding, FastAPI, or comparison requests.

The report shows the stored overall similarity, total PDF topic count, individual match-type counts, and a derived coverage percentage: `(STRONG + PARTIAL + WEAK) / total PDF topics * 100`. A single Recharts bar chart presents match distribution, while accessible progress bars show each PDF topic's stored similarity. Missing topics and the detailed PDF-to-lecture match list remain separate and readable. Lecture/PDF topic confidence values remain visible, and the transcript and extracted PDF text remain available in a collapsible source-text section.

All dashboard calculations are presentation-only and are not persisted. Phase 7 adds no database migration and does not recalculate embeddings or similarity.

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

- **Phase 8 and later:** deployment and explicitly scoped future production work.

No Phase 8 deployment work is implemented in Phase 7.
