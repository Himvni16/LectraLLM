# LectraLLM architecture

## High-level topology

```text
Browser → Next.js on Vercel → Supabase PostgreSQL
    ├──→ Cloudinary authenticated video storage
    ├──→ Supabase private PDF Storage
    └──→ Gemini Developer API
           ├── video transcription
           ├── structured topic extraction
           └── topic embeddings
```

PDF text extraction and cosine comparison run in server-side TypeScript inside the Next.js application.

## Next.js responsibilities

- Render upload, progress, retry, and completed-analysis interfaces.
- Authorize direct browser uploads to Cloudinary and Supabase Storage.
- Validate finalized provider assets before creating or advancing an analysis.
- Claim analysis stages with a database-backed processing lease.
- Stream authenticated Cloudinary video content into Gemini Files API uploads.
- Persist and reuse Gemini file identifiers across resumable transcription invocations.
- Download private PDFs and extract text with `unpdf`.
- Call Gemini for structured VIDEO/PDF topic extraction.
- Request one Gemini embedding per topic and compare vectors locally.
- Persist topics, matches, scores, provider identifiers, and workflow status through Prisma.

## Provider responsibilities

### Supabase PostgreSQL

Supabase PostgreSQL is the relational source of truth for analyses, workflow state, leases, source text, extracted topics, matches, and overall scores. Runtime access uses Prisma with `PrismaPg` and `pg` through the transaction pooler.

The custom migration runner uses the same transaction-pooler connection. Each migration acquires a transaction-scoped advisory lock, rechecks migration history after locking, applies at most one migration, and records Prisma-compatible history before committing.

### Supabase Storage

PDFs are stored under generated object paths in a private bucket. The browser receives narrowly scoped signed upload authorization. Server-side processing downloads only the object path already persisted on the selected analysis.

### Cloudinary

Lecture videos are stored as authenticated assets under generated public IDs. Before transcription, the server validates resource type, delivery type, format, and byte size, then creates a short-lived authenticated download URL.

### Gemini

Gemini handles three model-backed operations:

1. Video transcription from a temporary Files API upload.
2. Structured topic extraction for lecture transcripts and PDF text.
3. Semantic embeddings for deterministic local comparison.

Provider credentials remain server-only. Temporary Gemini video files are deleted after transcript generation or permanent provider failure where possible.

## Workflow orchestration

The application preserves the existing `AnalysisStatus` values. A `/run` invocation atomically claims the current stage with a unique processing token and a ten-minute expiry. External provider and storage calls occur outside database transactions. Only the matching token owner can persist completion or failure, advance status, or clear the lease.

Expired leases can be reclaimed. Transcription is additionally resumable through `Analysis.transcriptionProviderFile`: one invocation uploads, later invocations check Gemini file state, and an active file is used to generate and persist the transcript.

```text
UPLOADED
  → TRANSCRIBING
  → EXTRACTING_PDF
  → EXTRACTING_TOPICS
  → COMPARING
  → COMPLETED
```

Failures transition to the existing failed state and remain retryable according to the current workflow rules.

## PDF extraction boundary

The server downloads the PDF associated with the selected analysis from private Supabase Storage. The TypeScript extractor validates the file, preserves page order, normalizes whitespace conservatively, and rejects empty or unreadable results. The 25 MiB limit remains enforced. Only text PDFs are supported; no OCR is performed.

## Topic extraction boundary

Transcript and PDF text are sent to Gemini independently with source-specific instructions and a shared structured schema. Long inputs are chunked deterministically. Topic names are normalized and deduplicated while preserving confidence values, source separation, and stable ordering.

Both source results are persisted together before the analysis advances, preventing a partial topic replacement.

## Comparison boundary

The server loads stored VIDEO and PDF topics and requests one Gemini embedding for each topic in deterministic VIDEO-then-PDF order. Requests are bounded for free-tier friendliness. Every response must contain exactly one finite vector of the configured dimensionality.

PDF topics are the reference set. Local cosine comparison selects the highest-scoring VIDEO topic for each PDF topic, preserving first-on-tie behavior. Scores are clamped to `0..1` and classified as:

- `STRONG >= 0.75`
- `PARTIAL >= 0.55`
- `WEAK >= 0.35`
- `MISSING < 0.35`

Missing matches retain their score and store a null VIDEO relation. The overall score is `average(best similarity per PDF topic) * 100`.

## Dashboard boundary

The completed dashboard renders persisted analysis data. Presentation helpers derive match counts, coverage, and display percentages without changing database values or calling external providers.
