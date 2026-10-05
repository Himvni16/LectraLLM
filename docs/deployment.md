# LectraLLM deployment guide

This guide describes a provider-neutral production deployment for the existing Phase 0–7 application. Phase 8 does not deploy the project, add a storage provider, or introduce product functionality.

## Required services

Deploy these resources in a region with low network latency between them:

1. **Next.js web service** — serves the UI and server routes, owns Prisma/database access, and orchestrates analysis stages.
2. **Gemini Developer API** — receives temporary Files API uploads for video transcription and performs the existing topic extraction and embedding calls.
3. **Supabase PostgreSQL** — stores analyses, topics, matches, and workflow status.
4. **Cloudinary Free** — stores lecture videos uploaded directly from the browser.
5. **Supabase Storage Free** — stores PDFs in a private bucket.

```text
Browser → Next.js → Supabase PostgreSQL
    ├──→ Cloudinary (authenticated lecture videos)
    ├──→ Supabase Storage (private PDFs)
    └──→ Gemini Developer API (transcription, topic extraction, embeddings)
```

The FastAPI service should not be publicly callable unless network controls and an appropriate service-authentication layer are added in a separately scoped phase. If it is internal-only, `AI_SERVICE_URL` should use its private service URL.

## Runtime versions

- Node.js **20.19 or newer**; Node.js 22 LTS is recommended.
- npm 10 or newer.
- Python 3.12; Python 3.11 is also suitable for the pinned dependencies.
- PostgreSQL 15 or newer, provided by Supabase.

Do not lower the Node.js minimum: Next.js and the current toolchain depend on modern Node behavior.

## Web environment

Set these as server-side environment variables on the Next.js service:

| Variable | Required | Production value |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Pooled Supabase PostgreSQL URL used by the application runtime |
| `DIRECT_URL` | Only for direct Prisma CLI operations | Supabase direct/session URL; the custom PostgreSQL migration runner does not use it |
| `AI_SERVICE_URL` | Yes for the retained health proxy | FastAPI base URL; production analysis stages do not use it |
| `GEMINI_API_KEY` | Yes | Server-only Gemini Developer API key |
| `GEMINI_TRANSCRIPTION_MODEL` | No | Video transcription model; default `gemini-3.8-flash` |
| `VIDEO_MAX_SIZE_MB` | No | Upload limit in MiB; default `100` |
| `PDF_MAX_SIZE_MB` | No | Upload limit in MiB; default `25` |
| `AI_TRANSCRIPTION_TIMEOUT_SECONDS` | No | Gemini video transfer, processing, and generation timeout; default `1800` |
| `CLOUDINARY_CLOUD_NAME` | Yes | Cloudinary product-environment name |
| `CLOUDINARY_API_KEY` | Yes | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Yes | Server-only Cloudinary API secret |
| `CLOUDINARY_UPLOAD_FOLDER` | No | Video namespace; default `lectrallm/videos` |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only service-role key |
| `SUPABASE_STORAGE_BUCKET` | Yes | Existing private PDF bucket |

`DATABASE_URL` and `DIRECT_URL` are Supabase PostgreSQL secrets. Configure them through the hosting platform and never expose them through `NEXT_PUBLIC_*` variables. The web runtime and custom PostgreSQL migration runner both use the transaction-pooler `DATABASE_URL`; the runner uses transaction-scoped advisory locking and does not require session affinity. For that Supabase transaction-pooler endpoint, application code removes conflicting SSL query parameters in memory and passes `ssl: { rejectUnauthorized: false }` directly to `pg`, keeping TLS enabled without relying on `pg-connection-string` certificate semantics. `DIRECT_URL` is reserved for Prisma CLI operations that specifically require a direct/session connection. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` remain Storage/API credentials and are not Prisma connection URLs.

## AI service environment

Set these only on the FastAPI service:

| Variable | Required | Production value |
| --- | --- | --- |
| `AI_CORS_ORIGINS` | Yes | Comma-separated deployed Next.js origins, without paths |
| `WHISPER_MODEL` | No | faster-whisper model name/path; default `base` |
| `WHISPER_DEVICE` | No | `cpu`, `cuda`, or another supported CTranslate2 device |
| `WHISPER_COMPUTE_TYPE` | No | Compute type compatible with the selected device; default `int8` |
| `TRANSCRIPTION_MAX_SIZE_MB` | No | Media limit; align with the web video limit |
| `PDF_MAX_SIZE_MB` | No | PDF limit; align with the web PDF limit |
| `TOPIC_PROVIDER` | Yes | `gemini` |
| `GEMINI_API_KEY` | Yes for topic extraction | Gemini Developer API secret, stored only on this service |
| `GEMINI_TOPIC_MODEL` | No | Configured structured-output model |
| `TOPIC_CHUNK_CHARS` | No | Deterministic chunk size; default `12000` |
| `EMBEDDING_MODEL` | No | Local sentence-transformer name/path |

The production analysis pipeline requires `GEMINI_API_KEY` in the Next.js server environment. Never prefix it with `NEXT_PUBLIC_` or send it to the browser. The checked-in example contains only a placeholder.

## Provider storage and model caches

Lecture videos are stored under generated Cloudinary public IDs and PDFs under generated paths in a private Supabase Storage bucket. PostgreSQL stores only those stable identifiers. The browser uploads directly to each provider, so Vercel does not proxy the 100 MB video or 25 MB PDF request bodies. Configure the Supabase bucket as private with a 25 MB file-size limit and `application/pdf` as its allowed MIME type.

Before transcription, Next.js revalidates the Cloudinary asset's type, authenticated delivery mode, format, and configured 100 MiB limit. Because Gemini supports arbitrary uploaded files but not arbitrary external video URLs, Next.js creates a short-lived authenticated Cloudinary URL and streams it into a resumable Gemini Files API upload. It never creates a full in-memory video buffer. The returned Gemini file name is stored durably, and later requests check it once rather than waiting in a polling loop. The temporary Gemini file is deleted after generation or permanent provider failure where possible.

This server-to-server transfer is unavoidable with the documented Gemini video inputs and still consumes Vercel execution time and outbound bandwidth. Confirm the selected Vercel plan's function-duration and transfer constraints with a representative lecture before production rollout; this migration does not introduce a queue or background worker. The Cloudinary-to-Gemini upload and Gemini transcript generation are now separate requests, but either remaining individual operation can still theoretically exceed 300 seconds.

Analysis execution uses one resumable stage per HTTP invocation. The analysis row carries a ten-minute ownership lease, so overlapping polling, refreshes, and platform retries do not duplicate provider work. Transcription further divides into upload, one-shot status checks, and generation while retaining the user-visible `TRANSCRIBING` status. `PROCESSING` is a normal response and the browser waits five seconds before invoking `/run` again. The `/run` route and retained stage aliases set `maxDuration = 300`, the current maximum for Vercel Hobby with Fluid Compute. If an upload or generation is terminated, the lease expires for recovery; a persisted Gemini file is reused, while a crash before its identifier is saved may leave an unavoidable temporary orphan and a later request uploads again.

## Database setup and migrations

Use a dedicated production database and verify both URLs before deployment. Never use `prisma migrate dev` in production.

From a trusted release environment with production variables set:

```powershell
npm ci
npm run prisma:generate
npx prisma validate
npm run db:migrate:status
npm run db:migrate
```

The status command is read-only. The apply command uses the checked-in Prisma migration folders in lexical order, serializes against Prisma's PostgreSQL advisory lock, and records Prisma-compatible history. It refuses unresolved failures, checksum mismatches, or SQL that cannot be safely wrapped in its transaction policy. Back up the database according to the provider's operational guidance before applying migrations.

For an optional non-production sample analysis, run `npm run prisma:seed` after migrations. Do not seed a production database unless that sample data is explicitly wanted.

## Build and start the web service

From the repository root:

```powershell
npm ci
npm run prisma:generate
npm run build
npm start
```

Run the web service behind HTTPS. Upload authorization, finalization, and analysis creation send only small JSON requests to Vercel.

## Build and start the AI service

From `ai-service/`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The development `--reload` option must not be used in production. Start with one worker for predictable model memory use, then load-test before increasing concurrency.

## Health checks

- FastAPI direct health check: `GET /health` returns `{"status":"ok","service":"lectrallm-ai"}`.
- Next.js proxy health check: `GET /api/ai-health` returns the FastAPI result, or a sanitized `503` body when the AI service cannot be reached.

The health endpoints confirm process connectivity, not model availability, Gemini quota, persistent-disk writability, or database readiness. Monitor those separately through the hosting platform.

## Release checklist

1. Confirm the deployment uses Node.js 20.19+ and a supported Python version.
2. Configure all server-side variables and secrets; confirm no secret has a `NEXT_PUBLIC_` prefix.
3. Configure Cloudinary and the private Supabase PDF bucket before accepting uploads.
4. Install pinned Python dependencies and Node lockfile dependencies.
5. Generate Prisma Client, validate the schema, inspect `db:migrate:status`, and run `db:migrate`.
6. Run the full web and AI test suites and build the Next.js production bundle.
7. Start FastAPI, verify `/health`, then start Next.js and verify `/api/ai-health`.
8. Perform one controlled workflow smoke test using non-sensitive sample files. Expect first model-backed requests to be slower while model caches warm.
9. Confirm logs and browser responses contain no credentials, internal file paths, or raw provider errors.

## Common production issues

- **Supabase database connection fails:** verify that `DATABASE_URL` is the transaction-pooler URL, no higher-precedence local environment file overrides it, and database variables are configured only as server-side secrets.
- **Cloudinary upload fails:** verify the upload signature clock, API key, 100 MB file limit, and Free-plan credit usage.
- **Supabase PDF upload fails:** verify the bucket exists, is private, permits `application/pdf`, and has a 25 MB bucket file limit.
- **First transcription/comparison is slow:** model files are downloading or loading. Persist the Hugging Face cache and allow sufficient startup/request time.
- **FastAPI runs out of memory:** reduce worker count or model size and review the Whisper device/compute type.
- **Browser CORS failure:** set `AI_CORS_ORIGINS` to the exact deployed web origin. Normal browser workflow should still use Next.js routes rather than calling FastAPI directly.
- **Gemini extraction fails:** verify the AI-only API key, configured model availability, quota, and outbound network access. Provider details remain server-side.
- **Proxy returns 503:** check FastAPI `/health`, the internal `AI_SERVICE_URL`, service networking, and TLS/DNS configuration. Browser responses intentionally omit connection internals.
- **Large uploads fail:** confirm the browser is using the provider-signed URL rather than sending file bytes to a Next.js route.
- **Prisma CLI cannot connect while runtime works:** direct Prisma CLI connectivity can still depend on `DIRECT_URL`; the application and custom migration runner use the transaction-pooler `DATABASE_URL` instead.

## Scope boundary

This guide covers the existing LectraLLM workflow only. It does not add or assume authentication, multi-tenancy, an LMS, OCR, background queues, object storage, notifications, syllabus analysis, or provider-specific infrastructure.
