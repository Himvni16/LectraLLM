import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "arrow"
  | "chart"
  | "check"
  | "chevron"
  | "document"
  | "layers"
  | "sparkles"
  | "upload"
  | "video";

export function Icon({
  name,
  ...props
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    chart: (
      <>
        <path d="M4 19V9m6 10V5m6 14v-7m4 7H2" />
        <path d="m4 7 6-4 6 6 4-3" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m8 10 4 4 4-4" />,
    document: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5z" />
        <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3 1.1 3.1L16 7.5l-2.9 1.4L12 12l-1.1-3.1L8 7.5l2.9-1.4z" />
        <path d="m18.5 13 .7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7zM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m-5 5 5-5 5 5" />
        <path d="M5 14v6h14v-6" />
      </>
    ),
    video: (
      <>
        <rect height="14" rx="2" width="15" x="3" y="5" />
        <path d="m18 10 3-2v8l-3-2" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-[10px] bg-[#1b1d24] text-white shadow-sm">
        <span className="relative block h-3.5 w-3.5">
          <span className="absolute left-0 top-0 h-3.5 w-1.5 rounded-sm bg-white" />
          <span className="absolute bottom-0 right-0 h-1.5 w-2 rounded-sm bg-[#8b8cf6]" />
        </span>
      </span>
      {!compact ? (
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-[#17191f]">
          LectraLLM
        </span>
      ) : null}
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5b5ce2]">
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-[#17191f] sm:text-4xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 max-w-2xl text-base leading-7 text-[#686b75] sm:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function EmptyState({
  children,
  icon = "sparkles",
}: {
  children: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[#d9d9d2] bg-[#fafaf8] p-5 text-sm leading-6 text-[#686b75]">
      <span className="mb-3 grid size-9 place-items-center rounded-xl border border-[#e5e5df] bg-white text-[#5b5ce2] shadow-sm">
        <Icon className="size-4" name={icon} />
      </span>
      {children}
    </div>
  );
}
