export default function Home() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center px-6 py-20 sm:px-10">
      <section className="max-w-3xl">
        <p className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">
          Lecture intelligence, grounded in evidence
        </p>
        <h1 className="text-balance text-5xl font-semibold tracking-tight text-slate-950 sm:text-7xl">
          LectraLLM
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-xl leading-8 text-slate-600 sm:text-2xl">
          AI-powered lecture content validation and analysis
        </p>
        <div className="mt-10 inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
          <span className="size-2 rounded-full bg-blue-600" aria-hidden="true" />
          Foundation ready for future analysis workflows
        </div>
      </section>
    </main>
  );
}
