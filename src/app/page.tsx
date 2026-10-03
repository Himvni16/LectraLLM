import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-10">
      <section className="max-w-4xl">
        <p className="mb-6 text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
          LectraLLM
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.045em] text-zinc-950 sm:text-6xl lg:text-7xl">
          Compare lecture videos with PDF material using AI
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-zinc-600 sm:text-xl">
          Upload a lecture and its supporting material to review topic coverage,
          alignment, and missing concepts in one structured analysis.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            href="/upload"
          >
            Analyze lecture
          </Link>
          <p className="text-sm text-zinc-500">Video and PDF required</p>
        </div>
      </section>

      <section
        aria-label="How LectraLLM works"
        className="mt-20 grid border-y border-zinc-200 sm:grid-cols-3"
      >
        <WorkflowStep
          description="Select a lecture video and the PDF material it should cover."
          number="01"
          title="Upload sources"
        />
        <WorkflowStep
          description="LectraLLM transcribes, extracts topics, and compares the sources."
          number="02"
          title="Run analysis"
        />
        <WorkflowStep
          description="Inspect alignment, topic coverage, and source details."
          number="03"
          title="Review results"
        />
      </section>
    </main>
  );
}

function WorkflowStep({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-zinc-200 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:px-6 sm:first:pl-0 sm:last:border-r-0 sm:last:pr-0">
      <p className="text-xs font-medium tabular-nums text-zinc-400">{number}</p>
      <h2 className="mt-3 text-sm font-semibold text-zinc-950">{title}</h2>
      <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-600">
        {description}
      </p>
    </div>
  );
}
