import Link from "next/link";

import { ActionLink, appFrameClassName } from "@/components/ui";

export function Header() {
  return (
    <header className="glass-header sticky top-0 z-50">
      <div className={`${appFrameClassName} flex h-16 items-center justify-between`}>
        <Link
          className="rounded text-[17px] font-semibold tracking-[-0.035em] text-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
          href="/"
        >
          LectraLLM
        </Link>
        <nav aria-label="Primary navigation">
          <ActionLink href="/upload" size="compact">
            Upload lecture
          </ActionLink>
        </nav>
      </div>
    </header>
  );
}
