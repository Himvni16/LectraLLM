import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center px-4 py-16 sm:px-6 sm:py-20 lg:px-10">
      <section className="max-w-3xl">
        <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-600 sm:text-sm">
          Lecture intelligence, grounded in evidence
        </p>
        <h1 className="text-balance text-5xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-7xl">
          LectraLLM
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-xl leading-8 text-zinc-600 sm:text-2xl">
          AI-powered lecture content validation and analysis
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            href="/upload"
          >
            Upload lecture
          </Link>
          <div className="inline-flex items-center gap-3 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-600">
            <span
              className="size-2 rounded-full bg-zinc-950"
              aria-hidden="true"
            />
            Video + PDF upload ready
          </div>
        </div>
      </section>
    </main>
  );
}
