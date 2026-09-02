import { cn } from "@/lib/utils";

/**
 * Small form primitives in the same style as the existing shadcn components.
 * Every control here is a native element so keyboard operability and the
 * browser's own label association come for free.
 */

const CONTROL_BASE =
  "w-full rounded-md border border-input bg-background text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

function FieldHint({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-hint"
      className={cn("text-sm leading-snug text-muted-foreground", className)}
      {...props}
    />
  );
}

function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-error"
      className={cn("text-sm leading-snug font-medium text-destructive", className)}
      {...props}
    />
  );
}

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input data-slot="input" className={cn(CONTROL_BASE, "h-8 px-2.5", className)} {...props} />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(CONTROL_BASE, "min-h-24 px-2.5 py-2 leading-6", className)}
      {...props}
    />
  );
}

function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select data-slot="select" className={cn(CONTROL_BASE, "h-8 px-2", className)} {...props}>
      {children}
    </select>
  );
}

function Checkbox({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-4 shrink-0 rounded-sm border border-input accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox, FieldError, FieldHint, Input, Label, Select, Textarea };
