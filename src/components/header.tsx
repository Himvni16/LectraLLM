import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-50 bg-[#fbfaf6e6] backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-[#fbfaf6b8]">
      <div className="mx-auto flex h-16 max-w-[70rem] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          className="rounded text-[17px] font-semibold tracking-[-0.035em] text-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
          href="/"
        >
          LectraLLM
        </Link>
        <nav aria-label="Primary navigation">
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
            href="/upload"
          >
            Upload lecture
          </Link>
        </nav>
      </div>
    </header>
  );
}
