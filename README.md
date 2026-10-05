# LectraLLM

LectraLLM analyzes a lecture video against a corresponding PDF, compares topic coverage, and presents percentage-based and graphical results.

```text
Upload video + PDF → Transcribe video → Extract PDF text
→ Extract VIDEO/PDF topics → Compare topics → Persist report
```

## Architecture

- **App:** Next.js, React, TypeScript, and Tailwind CSS on Vercel.
- **Database:** Supabase PostgreSQL through Prisma, `PrismaPg`, and `pg`.
- **PDF storage:** Private Supabase Storage bucket.
- **Video storage:** Authenticated Cloudinary assets.
- **AI:** Gemini video transcription, structured topic extraction, and topic embeddings.
- **PDF extraction:** Server-side TypeScript using `unpdf`; text PDFs only, with no OCR.

See [docs/architecture.md](docs/architecture.md) for component boundaries and [docs/deployment.md](docs/deployment.md) for deployment guidance.

## Prerequisites

- Node.js 20.19 or newer; Node.js 22 LTS is recommended.
- npm 10 or newer.
- A Supabase project with PostgreSQL and a private PDF bucket.
- A Cloudinary product environment configured for authenticated video delivery.
- A Gemini Developer API key.

## Local setup

```powershell
npm install
Copy-Item .env.example .env.local
npm run prisma:generate
npm run dev
```

The app is available at `http://localhost:3000`.

## Environment

Keep server secrets out of `NEXT_PUBLIC_*` variables.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Supabase transaction-pooler URL used by PrismaPg and the custom migration runner |
| `DIRECT_URL` | Only for direct Prisma CLI operations | Supabase direct/session URL; not used by the custom migration runner |
| `GEMINI_API_KEY` | Yes | Server-only Gemini Developer API key |
| `GEMINI_TRANSCRIPTION_MODEL` | No | Video transcription model; defaults to `gemini-3.8-flash` |
| `GEMINI_TOPIC_MODEL` | No | Structured topic model; defaults to `gemini-3.5-flash-lite` |
| `TOPIC_CHUNK_CHARS` | No | Topic-extraction chunk size; defaults to `12000` |
| `GEMINI_EMBEDDING_MODEL` | No | Topic embedding model; defaults to `gemini-embedding-2` |
| `GEMINI_EMBEDDING_DIMENSIONS` | No | Embedding dimensions; defaults to `768` |
| `VIDEO_MAX_SIZE_MB` | No | Lecture video limit in MiB; defaults to `100` |
| `PDF_MAX_SIZE_MB` | No | PDF limit in MiB; defaults to `25` |
| `AI_TRANSCRIPTION_TIMEOUT_SECONDS` | No | Timeout for Gemini video operations; defaults to `1800` seconds |
| `CLOUDINARY_CLOUD_NAME` | Yes | Cloudinary product-environment name |
| `CLOUDINARY_API_KEY` | Yes | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Yes | Server-only Cloudinary signing and Admin API secret |
| `CLOUDINARY_UPLOAD_FOLDER` | No | Video namespace; defaults to `lectrallm/videos` |
| `SUPABASE_URL` | Yes | Supabase project URL used for Storage |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only Supabase service-role key |
| `SUPABASE_STORAGE_BUCKET` | Yes | Private PDF bucket name |

## Database

Runtime queries use `PrismaClient` with the PostgreSQL driver adapter. The custom migration runner reads checked-in Prisma migration folders, verifies their SHA-256 checksums, and maintains Prisma-compatible `_prisma_migrations` history.

```powershell
npm run prisma:generate
npx prisma validate
npm run db:migrate:status
npm run db:migrate
```

The status command is read-only. Migration application uses a transaction-scoped PostgreSQL advisory lock and rechecks history after acquiring the lock, so it is compatible with Supabase transaction pooling and concurrent runners cannot apply the same migration twice.

## Upload and analysis workflow

The browser uploads lecture videos directly to authenticated Cloudinary storage and PDFs directly to a private Supabase Storage bucket. Next.js authorizes and finalizes uploads, validates provider metadata, and stores only stable provider identifiers in PostgreSQL.

Analysis progresses through the existing user-visible statuses. Each `/run` invocation claims a ten-minute database lease and performs one resumable stage. Only the matching lease owner may persist results, advance status, or release the lease.

### Video transcription

Next.js verifies the stored Cloudinary asset, creates a short-lived authenticated URL, and streams it into the Gemini Files API. The Gemini file identifier is persisted so later invocations can check processing state and generate the transcript without uploading the video again.

### PDF text extraction

Next.js downloads the database-controlled PDF object from private Supabase Storage and extracts text in page order with `unpdf`. Whitespace is normalized conservatively. Empty or unreadable text PDFs fail clearly; OCR is not performed.

### Topic extraction

The server sends transcript and PDF text to Gemini independently as `VIDEO` and `PDF` sources. Structured responses preserve confidence values, long inputs are chunked deterministically, and normalized duplicate topic names are merged before persistence.

### Topic comparison

The server requests one Gemini embedding per topic in deterministic VIDEO-then-PDF order, calculates cosine similarity locally, and selects the best VIDEO topic for every PDF topic. Thresholds remain `STRONG >= 0.75`, `PARTIAL >= 0.55`, `WEAK >= 0.35`, and `MISSING < 0.35`. The overall score is the average best similarity across PDF topics multiplied by 100.

### Completed report

The completed dashboard reads persisted analyses, topics, matches, and scores. It does not invoke providers or recalculate stored comparison results.

## Validation

```powershell
npx prisma validate
npx prisma generate
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

## npm scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start local Next.js development |
| `npm run build` | Create a production build |
| `npm start` | Run the production server |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Vitest suite |
| `npm run db:migrate:status` | Inspect migration history without applying changes |
| `npm run db:migrate` | Apply pending checked-in migrations |
| `npm run prisma:generate` | Generate Prisma Client |

## Scope

LectraLLM covers lecture/PDF analysis only. It does not implement authentication, multi-tenancy, course administration, OCR, background queues, notifications, or syllabus management.
