# Zero-billing storage deployment

LectraLLM's storage path is designed for accounts that remain on providers'
free plans and do not enable usage-based billing. Provider quotas can change;
check each linked dashboard before deployment and monitor usage rather than
assuming that a free quota is unlimited.

## Architecture

```text
Browser ──signed upload──> Cloudinary Free (lecture video, up to 100 MB)
       └─signed upload──> Supabase Storage Free (private PDF, up to 25 MB)
       └─small JSON─────> Vercel Hobby / Next.js ──> Supabase PostgreSQL
                                             └────> Gemini free tier
```

Cloudinary and Supabase file bodies never pass through Vercel Functions. The
existing Prisma columns store a generated Cloudinary public ID and a generated
Supabase object path.

Videos use Cloudinary's `authenticated` delivery type. The browser receives a
signature only for the generated public ID, and the transcription client later
uses a short-lived server-generated private download URL.

## Required provider setup

### Cloudinary Free

Create a free Programmable Media account and do not upgrade it or attach a
paid plan. The Free plan is advertised as free forever with no credit card and
currently includes 25 monthly credits shared across storage, transformations,
and bandwidth. One Free-plan credit corresponds to 1 GB of managed storage or
1 GB of video bandwidth. LectraLLM deliberately requests no transformations,
but transcription downloads still consume delivery bandwidth. The normal
Cloudinary upload method supports files up to 100 MB, which is why the product
limit is 100 MB.

References: [Cloudinary pricing](https://cloudinary.com/pricing),
[billing and credits](https://cloudinary.com/documentation/billing_and_plans),
[video upload limits](https://cloudinary.com/documentation/node_image_and_video_upload).

### Supabase Storage Free

Create an existing **private** bucket named by `SUPABASE_STORAGE_BUCKET`.
Configure its maximum file size to 25 MB and allowed MIME types to
`application/pdf`. Signed upload URLs are currently valid for two hours; the
application's own upload manifest expires sooner. Supabase Free currently
includes 1 GB of Storage and 5 GB of egress. Free-plan storage overage is not
billed, but service can be restricted when quota is exhausted.

Supabase recommends resumable TUS uploads above 6 MB for maximum reliability.
This isolated migration uses its signed standard-upload contract for PDFs up to
25 MB; a failed browser upload is retried by starting a new authorization flow.

References: [signed upload URLs](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl),
[private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[Free-plan quotas](https://supabase.com/docs/guides/platform/billing-on-supabase).

### Vercel Hobby

Keep the project on Hobby and within its included quotas. Hobby is intended
for personal, non-commercial projects. Vercel Functions have a 4.5 MB
request/response payload limit, which this architecture avoids for uploads by
sending only metadata and manifests through Next.js. Function duration,
memory, CPU, invocation, and bandwidth quotas still apply to analysis work.

References: [Vercel Hobby](https://vercel.com/docs/plans/hobby),
[Function limits](https://vercel.com/docs/functions/limitations).

### Supabase PostgreSQL and Gemini free tier

Use the Supabase PostgreSQL project for relational data and monitor its storage
and compute allowance; uploaded media is not stored in PostgreSQL. Keep the Gemini API
project on its Free tier without attaching billing. Gemini request and token
limits are model- and project-specific and are visible in Google AI Studio;
requests stop or return quota errors when those limits are reached.

References: [Gemini billing](https://ai.google.dev/gemini-api/docs/billing/),
[Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

## Secrets

Set these only in the server environment:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
CLOUDINARY_UPLOAD_FOLDER=lectrallm/videos
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
```

The browser receives the Cloudinary cloud name/API key with a narrowly scoped
signature, plus a Supabase signed upload URL. It never receives either provider
secret.
