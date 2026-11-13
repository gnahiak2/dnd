import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ");
export { cx };

type Tone = "default" | "primary" | "danger" | "ghost";

const tones: Record<Tone, string> = {
  default: "border-line bg-raised text-parchment hover:border-faint",
  primary: "border-amber bg-amber text-ink font-semibold hover:brightness-110",
  danger: "border-danger/60 bg-transparent text-danger hover:bg-danger/10",
  ghost: "border-transparent bg-transparent text-muted hover:text-parchment hover:bg-raised",
};

export function Button({
  tone = "default",
  small = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; small?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        small ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-sm",
        tones[tone],
        className,
      )}
    />
  );
}

const field =
  "w-full rounded border border-line bg-ink px-2 py-1.5 text-sm text-parchment placeholder:text-faint disabled:opacity-50";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(field, className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(field, "resize-y", className)} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cx(field, "pr-1", className)} />;
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Check({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted", className)}>
      <input type="checkbox" {...rest} className="h-3.5 w-3.5 accent-amber" />
      <span>{label}</span>
    </label>
  );
}

export function Panel({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-md border border-line bg-panel", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="font-serif text-[15px] text-parchment">{title}</h2>
        {action}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}
