import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export const appFrameClassName =
  "mx-auto w-full max-w-[var(--container-max)] px-4 sm:px-6 lg:px-8";

export function PageShell({
  children,
  className,
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  variant?: "default" | "home";
}) {
  return (
    <main
      className={cx(
        appFrameClassName,
        variant === "home" ? "home-shell" : "page-shell",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
      {children}
    </p>
  );
}

export function PageHeader({
  aside,
  description,
  eyebrow,
  meta,
  title,
}: {
  aside?: ReactNode;
  description?: string;
  eyebrow: string;
  meta?: ReactNode;
  title: string;
}) {
  return (
    <header>
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-5xl font-semibold tracking-[-0.045em] text-black sm:text-6xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600 sm:text-lg sm:leading-8">
              {description}
            </p>
          ) : null}
          {meta ? (
            <div className="mt-4 break-words text-base font-medium leading-7 text-zinc-700 sm:text-lg">
              {meta}
            </div>
          ) : null}
        </div>
        {aside}
      </div>
    </header>
  );
}

const actionBase =
  "inline-flex items-center justify-center rounded-[var(--radius-pill)] bg-black text-sm font-medium text-white transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600";

function actionSize(size: "primary" | "compact") {
  return size === "primary"
    ? "h-[var(--control-primary)] px-6"
    : "h-[var(--control-compact)] px-4";
}

export function Button({
  className,
  size = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "primary" | "compact";
}) {
  return (
    <button
      className={cx(actionBase, actionSize(size), className)}
      {...props}
    />
  );
}

export function ActionLink({
  children,
  className,
  href,
  size = "primary",
}: {
  children: ReactNode;
  className?: string;
  href: string;
  size?: "primary" | "compact";
}) {
  return (
    <Link className={cx(actionBase, actionSize(size), className)} href={href}>
      {children}
    </Link>
  );
}

export type StatusTone = "dark" | "mid" | "outline" | "soft";

const statusTone: Record<StatusTone, string> = {
  dark: "border-zinc-950 bg-zinc-950 text-white",
  mid: "border-zinc-700 bg-zinc-700 text-white",
  outline: "border-zinc-300 bg-transparent text-zinc-800",
  soft: "border-zinc-300 bg-zinc-200 text-zinc-950",
};

export function StatusBadge({
  children,
  dot = true,
  size = "default",
  tone = "outline",
}: {
  children: ReactNode;
  dot?: boolean;
  size?: "default" | "small";
  tone?: StatusTone;
}) {
  return (
    <span
      className={cx(
        "inline-flex w-fit shrink-0 items-center rounded-[var(--radius-pill)] border font-medium",
        size === "default"
          ? "h-[var(--control-compact)] gap-2 px-4 text-sm"
          : "h-6 gap-2 px-3 text-[11px]",
        statusTone[tone],
      )}
    >
      {dot ? (
        <span aria-hidden="true" className="size-2 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}

export function MetricCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div
      className="flex min-h-20 flex-col justify-between rounded-[var(--radius-card)] border border-zinc-200 bg-transparent px-4 py-3"
      data-primary-metric
    >
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold leading-none tracking-tight text-zinc-950">
        {value}
      </p>
    </div>
  );
}

export function ProgressBar({
  className,
  indicatorClassName = "bg-zinc-950",
  label,
  value,
}: {
  className?: string;
  indicatorClassName?: string;
  label: string;
  value: number;
}) {
  const boundedValue = Math.min(100, Math.max(0, value));

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={value}
      className={cx(
        "h-1.5 overflow-hidden rounded-full bg-zinc-200",
        className,
      )}
      role="progressbar"
    >
      <div
        className={cx("h-full rounded-full", indicatorClassName)}
        style={{ width: `${boundedValue}%` }}
      />
    </div>
  );
}

export function TabsList({
  ariaLabel,
  children,
  className,
}: {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("overflow-x-auto border-b border-zinc-200", className)}>
      <div
        aria-label={ariaLabel}
        className="flex min-w-max gap-2"
        role="tablist"
      >
        {children}
      </div>
    </div>
  );
}

export function TabButton({
  children,
  className,
  selected,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected: boolean;
}) {
  return (
    <button
      className={cx(
        "relative h-[var(--control-compact)] px-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950",
        selected
          ? "text-zinc-950 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-zinc-950"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function FilePicker({
  accept,
  description,
  file,
  id,
  label,
  name = id,
  onChange,
}: {
  accept: string;
  description: string;
  file: File | null;
  id: string;
  label: string;
  name?: string;
  onChange: (file: File | null) => void;
}) {
  const descriptionId = `${id}-description`;
  const labelId = `${id}-label`;

  return (
    <div className="min-w-0 py-6 md:first:pr-6 md:last:pl-6">
      <p className="text-sm font-semibold text-zinc-900" id={labelId}>
        {label}
      </p>
      <p className="mt-1 text-sm text-zinc-500" id={descriptionId}>
        {description}
      </p>
      <input
        accept={accept}
        aria-describedby={descriptionId}
        aria-labelledby={labelId}
        className="peer sr-only"
        id={id}
        name={name}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        type="file"
      />
      <label
        className={cx(
          "group mt-3 flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-[var(--radius-card)] border px-4 py-3 transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-black",
          file
            ? "border-zinc-300 bg-zinc-100 hover:border-zinc-400"
            : "border-zinc-300 bg-transparent hover:border-zinc-500",
        )}
        htmlFor={id}
      >
        <span className="min-w-0">
          <span className="block text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">
            {file ? "Selected file" : "Select file"}
          </span>
          <span className="mt-1 block truncate text-sm font-medium text-black">
            {file ? file.name : "Choose from your device"}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="inline-flex h-[var(--control-compact)] shrink-0 items-center rounded-[var(--radius-pill)] bg-black px-4 text-sm font-medium text-white transition group-hover:bg-zinc-700"
        >
          Browse
        </span>
      </label>
    </div>
  );
}

export function EmptyState({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cx(
        "rounded-[var(--radius-card)] bg-zinc-100 p-4 text-sm leading-6 text-zinc-600",
        className,
      )}
    >
      {children}
    </p>
  );
}
