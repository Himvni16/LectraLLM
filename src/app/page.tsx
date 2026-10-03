import { ActionLink, Eyebrow, PageShell } from "@/components/ui";

export default function Home() {
  return (
    <PageShell variant="home">
      <section className="max-w-5xl">
        <Eyebrow>LectraLLM</Eyebrow>
        <h1 className="mt-6 text-balance text-[clamp(3rem,6.6vw,5.25rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-black">
          Compare lecture videos with PDF material using AI
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-zinc-600 sm:text-xl">
          Upload a lecture and its supporting material to review topic coverage,
          alignment, and missing concepts in one structured analysis.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <ActionLink href="/upload">
            Analyze lecture
          </ActionLink>
          <p className="text-sm text-zinc-500">Video and PDF required</p>
        </div>
      </section>

      <section
        aria-label="How LectraLLM works"
        className="home-workflow mt-12 grid border-y border-zinc-200 sm:mt-16 sm:grid-cols-3"
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
    </PageShell>
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
    <div className="border-b border-zinc-200 py-6 last:border-b-0 sm:border-b-0 sm:border-r sm:border-zinc-100 sm:px-8 sm:py-8 sm:first:pl-0 sm:last:border-r-0 sm:last:pr-0">
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
