import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 sm:px-10">
        <Link
          className="text-base font-semibold tracking-tight text-slate-950"
          href="/"
        >
          LectraLLM
        </Link>
        <nav aria-label="Primary navigation">
          <Link
            className="text-sm font-medium text-slate-600 transition hover:text-blue-700"
            href="/upload"
          >
            Upload lecture
          </Link>
        </nav>
      </div>
    </header>
  );
}
