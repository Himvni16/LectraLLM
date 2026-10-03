import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-10">
        <Link
          className="rounded text-base font-semibold tracking-tight text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-950"
          href="/"
        >
          LectraLLM
        </Link>
        <nav aria-label="Primary navigation">
          <Link
            className="rounded text-sm font-medium text-zinc-600 transition hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-950"
            href="/upload"
          >
            Upload lecture
          </Link>
        </nav>
      </div>
    </header>
  );
}
