import Link from "next/link";

export default function Home() {
  return (
    <main className="home-shell mx-auto max-w-[70rem] px-4 sm:px-6 lg:px-8">
      <section className="max-w-5xl">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
          LectraLLM
        </p>
        <h1 className="mt-8 text-balance text-[clamp(3rem,7.2vw,5.75rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-black">
          Compare lecture videos with PDF material using AI
        </h1>
        <p className="mt-8 max-w-2xl text-pretty text-lg leading-8 text-zinc-600 sm:text-xl">
          Upload a lecture and its supporting material to review topic coverage,
          alignment, and missing concepts in one structured analysis.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-black px-6 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            href="/upload"
          >
            Analyze lecture
          </Link>
          <p className="text-sm text-zinc-500">Video and PDF required</p>
        </div>
      </section>

      <section
        aria-label="How LectraLLM works"
        className="home-workflow mt-16 grid border-y border-zinc-200 sm:mt-20 sm:grid-cols-3 lg:mt-24"
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
    <div className="border-b border-zinc-200 py-6 last:border-b-0 sm:border-b-0 sm:border-r sm:px-7 sm:py-8 sm:first:pl-0 sm:last:border-r-0 sm:last:pr-0">
      <p className="text-xs font-medium tabular-nums text-zinc-400">{number}</p>
      <h2 className="mt-4 text-base font-semibold tracking-tight text-zinc-950">
        {title}
      </h2>
      <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-600">
        {description}
      </p>
    </div>
  );
}
