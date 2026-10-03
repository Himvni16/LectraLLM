import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-50 bg-transparent">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-10">
        <Link
          className="rounded text-base font-semibold tracking-tight text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-950"
          href="/"
        >
          LectraLLM
        </Link>
        <nav aria-label="Primary navigation">
          <Link
            className="inline-flex min-h-9 items-center justify-center rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            href="/upload"
          >
            Upload lecture
          </Link>
        </nav>
      </div>
    </header>
  );
}
