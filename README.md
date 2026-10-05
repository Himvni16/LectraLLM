# LectraLLM

LectraLLM is an AI-powered lecture content comparison tool that analyzes a lecture video and its corresponding PDF, compares topic coverage, and produces percentage-based and graphical analysis.

## Current phase

**Phase 8 — final testing, hardening, documentation cleanup, and deployment readiness is complete.** The repository includes the Phase 0 foundation, the relational and upload workflows, local lecture transcription, text-based PDF extraction, separate LLM-based topic extraction, local embedding-based comparison, and a completed-analysis report derived from stored comparison results.

Phase 8 adds no product functionality or database schema changes. LectraLLM is not an LMS and does not include users, courses, roles, syllabus management, student accounts, notifications, or administration features.

```text
Upload video + PDF → Transcribe → Extract PDF text → Extract VIDEO/PDF topics
→ Compare topics → Persist matches and score → Render completed dashboard
```

## Architecture overview

- **Next.js + React + TypeScript + Tailwind CSS:** primary web application and Recharts-backed analysis dashboard at the repository root.
- **Supabase PostgreSQL + Prisma:** relational persistence for analyses, extracted topics, best-match results, and overall similarity. Runtime queries use Prisma's standard PostgreSQL client.
- **Gemini Developer API:** server-side video transcription, structured topic extraction, and topic embeddings. Lecture videos are transferred from authenticated Cloudinary storage to the Gemini Files API before transcription.
- **FastAPI + Python:** retained under `ai-service/` for legacy/local compatibility and its health endpoint; the production analysis pipeline no longer calls its transcription endpoint.

See [docs/architecture.md](docs/architecture.md) for service responsibilities and [docs/deployment.md](docs/deployment.md) for a provider-neutral production checklist.

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
| `DATABASE_URL` | Yes | Pooled Supabase PostgreSQL URL used by application/runtime Prisma queries |
| `DIRECT_URL` | Yes for Prisma CLI | Direct Supabase PostgreSQL URL used by migrations and administrative commands |
| `AI_SERVICE_URL` | Yes for legacy health proxy | Base URL used only by the retained FastAPI health proxy |
| `GEMINI_API_KEY` | Yes | Server-only Gemini Developer API key |
| `GEMINI_TRANSCRIPTION_MODEL` | No | Video transcription model; defaults to `gemini-3.8-flash` |
| `VIDEO_MAX_SIZE_MB` | No | Lecture video limit in MiB; defaults to `100` |
| `PDF_MAX_SIZE_MB` | No | Lecture PDF limit in MiB; defaults to `25` |
| `AI_TRANSCRIPTION_TIMEOUT_SECONDS` | No | Gemini Files upload, processing, and transcription timeout; defaults to `1800` seconds |
| `CLOUDINARY_CLOUD_NAME` | Yes | Cloudinary Free product-environment name |
| `CLOUDINARY_API_KEY` | Yes | Cloudinary public API key returned only with narrowly scoped upload signatures |
| `CLOUDINARY_API_SECRET` | Yes | Server-only Cloudinary signing and Admin API secret |
| `CLOUDINARY_UPLOAD_FOLDER` | No | Video namespace; defaults to `lectrallm/videos` |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only key used to authorize and verify private PDF objects |
| `SUPABASE_STORAGE_BUCKET` | Yes | Existing private bucket used for PDFs |

Copy `.env.example` and adjust credentials. Required server values are validated when the Next.js server starts and produce an actionable error when absent.

The AI service optionally reads `ai-service/.env`. Its `AI_CORS_ORIGINS` value is a comma-separated list and defaults to the two common local Next.js origins.

## Database setup

1. Provision a Supabase PostgreSQL database.
2. Set `DATABASE_URL` in `.env.local` to the Supabase pooled runtime URL (typically the pooler host on port `6543`). The singleton application client uses Prisma's standard PostgreSQL connection configuration.
3. Set `DIRECT_URL` to the corresponding direct Supabase database URL (typically `db.<project-ref>.supabase.co` on port `5432`). Prisma CLI, schema validation, and migration operations use this direct connection through the Prisma datasource configuration.
4. For local development, apply the checked-in migrations with `npx prisma migrate dev`. For production, use `npx prisma migrate deploy`.
5. Run `npm run prisma:generate`.

The migration creates only `Analysis`, `Topic`, and `TopicMatch`, plus their supporting enums and indexes. For optional development sample data, run `npm run prisma:seed` after applying the migration.

### Supabase PostgreSQL connectivity

Use the pooler URL only for application runtime queries and the direct database URL only for Prisma CLI operations. LectraLLM retains a bounded `P1001` retry around application database boundaries, including Analysis creation, loading, and transcription/PDF-extraction state updates. Other Prisma and application validation errors are not retried. Retry logs contain only the operation name, error code, and attempt metadata; database URLs and credentials are never returned to the browser.

## Upload workflow

Open `http://localhost:3000/upload`, select one lecture video and one corresponding PDF, and submit them together. The browser uploads the video directly to Cloudinary and the PDF directly to a private Supabase Storage bucket using short-lived server-issued authorization. Next.js receives metadata only, verifies both provider objects, and creates one `Analysis` record with status `UPLOADED`.

Supported video formats:

- MP4 (`.mp4`, `video/mp4`)
- QuickTime MOV (`.mov`, common QuickTime MIME types)
- WebM (`.webm`, `video/webm`)

The document must be a `.pdf` with the `application/pdf` MIME type when the browser supplies one. Empty, missing, duplicate, invalid, or oversized files are rejected server-side with readable errors.

Cloudinary public IDs and Supabase object paths use collision-safe UUID namespaces; original sanitized filenames remain in the database. The browser never receives Cloudinary's API secret or Supabase's service-role key, and large file bodies do not pass through Next.js.

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
| `TRANSCRIPTION_MAX_SIZE_MB` | `100` | Maximum media size accepted by `/transcribe` |
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

Next.js revalidates the authenticated Cloudinary asset attached to the selected `Analysis`, creates a short-lived signed download URL, and streams that response into a resumable Gemini Files API upload without buffering the full video in memory. Once Gemini marks the temporary file active, the configured `GEMINI_TRANSCRIPTION_MODEL` receives the video and the transcript-only prompt. The returned text is stored unchanged in `Analysis.transcriptText`; the Gemini temporary file is deleted on success or failure, and the original Cloudinary video remains unchanged.

Gemini does not accept an arbitrary Cloudinary video URL as direct video input. YouTube URLs are the documented direct-URL video case, and URL Context does not support video, so the Files API transfer is required. The transfer and model call still execute inside the Next.js request path; Vercel function duration remains a deployment concern and is intentionally not solved by this migration.

To smoke-test an already uploaded production-shaped asset without changing an analysis, run:

```powershell
node --conditions=react-server --import tsx scripts/gemini-cloudinary-transcription-poc.ts "lectrallm/videos/<uuid>"
```

If transcription fails, the analysis becomes `FAILED` and can be retried from the analysis page. Browser responses do not include internal storage or temporary paths.

The browser drives analysis through repeated `POST /api/analyses/<id>/run` calls. Each invocation performs at most one stage, then returns the persisted status and whether another run is required. A database-backed 10-minute lease prevents overlapping Vercel instances from running the same stage; expired leases can be reclaimed after an interrupted invocation. Completed transcript, PDF text, topic, and comparison artifacts are detected before provider work so retries resume at the earliest incomplete stage.

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

## Production deployment

The production path uses the Next.js web service, Supabase PostgreSQL, Cloudinary, private Supabase Storage, and the Gemini Developer API. The retained FastAPI project is not called by production transcription and does not need to host faster-whisper for this path. Configure secrets through the hosting platform, run checked-in migrations with `npx prisma migrate deploy`, and build the web application with Node.js 20.19+ (Node.js 22 LTS recommended).

The complete commands, environment variables, storage/model-cache considerations, health checks, and troubleshooting guidance are in [docs/deployment.md](docs/deployment.md). Phase 8 makes the repository deployment-ready but does not deploy it to a hosting provider.

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

## Scope after Phase 8

Further product work is intentionally unspecified and must be separately scoped. Phase 8 does not add authentication, LMS features, OCR, syllabus processing, notifications, administration, or new analysis behavior.
