# LectraLLM deployment guide

This guide describes a provider-neutral production deployment for the existing Phase 0–7 application. Phase 8 does not deploy the project, add a storage provider, or introduce product functionality.

## Required services

Deploy these resources in a region with low network latency between them:

1. **Next.js web service** — serves the UI and server routes, owns Prisma/database access, and orchestrates analysis stages.
2. **FastAPI AI service** — performs transcription, PDF extraction, Gemini topic extraction, and local embedding comparison. It does not access PostgreSQL.
3. **PostgreSQL/Neon** — stores analyses, topics, matches, and workflow status.
4. **Persistent web storage** — mounts at the repository/application `storage/` directory for uploaded videos and PDFs.

```text
Browser → Next.js → PostgreSQL/Neon
              └──→ FastAPI → Gemini Developer API (topic extraction only)
                         └──→ local Whisper and sentence-transformer models
```

The FastAPI service should not be publicly callable unless network controls and an appropriate service-authentication layer are added in a separately scoped phase. If it is internal-only, `AI_SERVICE_URL` should use its private service URL.

## Runtime versions

- Node.js **20.19 or newer**; Node.js 22 LTS is recommended.
- npm 10 or newer.
- Python 3.12; Python 3.11 is also suitable for the pinned dependencies.
- PostgreSQL 15 or newer, or a compatible Neon project.

Do not lower the Node.js minimum: Next.js and the current toolchain depend on modern Node behavior.

## Web environment

Set these as server-side environment variables on the Next.js service:

| Variable | Required | Production value |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Pooled Neon/PostgreSQL URL used by the runtime Neon serverless adapter |
| `DIRECT_URL` | Yes for deployment operations | Direct, non-pooler URL used by Prisma CLI and migrations |
| `AI_SERVICE_URL` | Yes | Internal base URL of the FastAPI service; do not append an endpoint path |
| `VIDEO_MAX_SIZE_MB` | No | Upload limit in MiB; default `250` |
| `PDF_MAX_SIZE_MB` | No | Upload limit in MiB; default `25` |
| `AI_TRANSCRIPTION_TIMEOUT_SECONDS` | No | AI request timeout in seconds; default `1800` |

`DATABASE_URL` and `DIRECT_URL` are secrets. Configure them through the hosting platform and never expose them through `NEXT_PUBLIC_*` variables. The web runtime uses the pooled URL through `PrismaNeon`; Prisma migration commands use `DIRECT_URL` from the schema datasource.

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

Never put `GEMINI_API_KEY` in the Next.js environment or send it to the browser. The checked-in example deliberately contains an empty placeholder.

## Persistent files and model caches

The current upload implementation writes to `storage/videos/` and `storage/pdfs/`, while PostgreSQL stores their relative paths. A production Next.js service therefore **requires a persistent disk mounted at `storage/`**. Ephemeral disks can silently lose source files after restarts or redeployments. Multiple web instances require a truly shared volume and compatible request topology; otherwise use a future, separately scoped object-storage implementation.

FastAPI streams incoming files to the operating system's temporary directory. That directory must be writable and can be ephemeral because temporary files are removed after each request.

faster-whisper and sentence-transformers download model artifacts on first use. Give the AI service sufficient disk and memory. Persisting the standard Hugging Face cache is recommended to avoid repeated downloads after restarts; otherwise expect slower first requests and outbound network usage. Size CPU/GPU resources for the selected models and avoid excessive worker counts because each worker can load its own model copy.

## Database setup and migrations

Use a dedicated production database and verify both URLs before deployment. Never use `prisma migrate dev` in production.

From a trusted release environment with production variables set:

```powershell
npm ci
npm run prisma:generate
npx prisma validate
npx prisma migrate deploy
```

`migrate deploy` applies only the checked-in migrations and does not reset data. Back up the database according to the provider's operational guidance before applying migrations.

For an optional non-production sample analysis, run `npm run prisma:seed` after migrations. Do not seed a production database unless that sample data is explicitly wanted.

## Build and start the web service

From the repository root:

```powershell
npm ci
npm run prisma:generate
npm run build
npm start
```

Run the web service behind HTTPS. Ensure the proxy accepts request bodies at least as large as the configured video limit and uses timeouts long enough for the synchronous Phase 3–6 requests.

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
3. Attach the persistent `storage/` volume before accepting uploads.
4. Install pinned Python dependencies and Node lockfile dependencies.
5. Generate Prisma Client, validate the schema, and run `prisma migrate deploy`.
6. Run the full web and AI test suites and build the Next.js production bundle.
7. Start FastAPI, verify `/health`, then start Next.js and verify `/api/ai-health`.
8. Perform one controlled workflow smoke test using non-sensitive sample files. Expect first model-backed requests to be slower while model caches warm.
9. Confirm logs and browser responses contain no credentials, internal file paths, or raw provider errors.

## Common production issues

- **Neon is slow after idle:** Neon can auto-suspend. Runtime access uses its serverless adapter and the application retries only transient Prisma `P1001` first-connection failures up to three total attempts. No manual wake-up is required.
- **Uploads disappear after restart:** the web service is using ephemeral storage or the disk is mounted at the wrong path. Mount durable storage at `storage/` before uploading.
- **A stored file cannot be found on another instance:** instances do not share the same volume. Use a shared filesystem topology or keep a single web instance until external object storage is separately implemented.
- **First transcription/comparison is slow:** model files are downloading or loading. Persist the Hugging Face cache and allow sufficient startup/request time.
- **FastAPI runs out of memory:** reduce worker count or model size and review the Whisper device/compute type.
- **Browser CORS failure:** set `AI_CORS_ORIGINS` to the exact deployed web origin. Normal browser workflow should still use Next.js routes rather than calling FastAPI directly.
- **Gemini extraction fails:** verify the AI-only API key, configured model availability, quota, and outbound network access. Provider details remain server-side.
- **Proxy returns 503:** check FastAPI `/health`, the internal `AI_SERVICE_URL`, service networking, and TLS/DNS configuration. Browser responses intentionally omit connection internals.
- **Large uploads fail before reaching Next.js:** increase the hosting proxy/body limit and align it with `VIDEO_MAX_SIZE_MB` and `PDF_MAX_SIZE_MB`.
- **Prisma CLI cannot connect while runtime works:** verify `DIRECT_URL` is the direct endpoint and is available to the release environment; runtime uses the separate pooled `DATABASE_URL`.

## Scope boundary

This guide covers the existing LectraLLM workflow only. It does not add or assume authentication, multi-tenancy, an LMS, OCR, background queues, object storage, notifications, syllabus analysis, or provider-specific infrastructure.
