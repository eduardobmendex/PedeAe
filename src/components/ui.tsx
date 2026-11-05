import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Componentes base. Usam somente tokens (bg-surface, text-muted, bg-brand…),
// então funcionam nos temas White e Black e com a cor de cada estabelecimento.

type ButtonVariant = "primary" | "brand" | "secondary" | "ghost" | "danger";

const buttonBase =
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-contrast hover:bg-brand-hover disabled:bg-disabled disabled:text-disabled-text disabled:opacity-100",
  brand: "bg-brand text-brand-contrast hover:bg-brand-hover",
  secondary: "border border-border-strong bg-surface hover:bg-hover",
  ghost: "hover:bg-hover",
  danger: "border border-danger/40 text-danger hover:bg-danger-soft",
};

export function buttonClass(variant: ButtonVariant = "primary", className = "") {
  return `${buttonBase} ${buttonVariants[variant]} ${className}`;
}

export function Button({ className = "", variant = "primary", ...props }: ComponentProps<"button"> & {
  variant?: ButtonVariant;
}) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({ className = "", variant = "primary", ...props }: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
}) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

const fieldBase =
  "h-10 w-full rounded-lg border border-input-border bg-input px-3 text-sm text-text outline-none transition placeholder:text-muted focus:border-brand";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`${fieldBase} ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea className={`${fieldBase} h-auto min-h-20 py-2 ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select className={`${fieldBase} w-auto pr-8 ${className}`} {...props} />;
}

export function Field({ label, htmlFor, hint, children }: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-xl border border-border bg-surface p-5 shadow-card ${className}`} {...props} />;
}

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-badge text-badge-text",
  brand: "bg-brand text-brand-contrast",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

export function Badge({ tone = "neutral", className = "", ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses[tone]} ${className}`}
      {...props}
    />
  );
}

export function PageHeader({ title, description, actions }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}

export function FormMessage({ state }: { state?: { error?: string; success?: string } }) {
  if (state?.error)
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  if (state?.success)
    return (
      <p role="status" className="text-sm text-success">
        {state.success}
      </p>
    );
  return null;
}
