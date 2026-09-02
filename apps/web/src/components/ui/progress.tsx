import { cn } from "@/lib/utils";

interface ProgressProps extends React.ComponentProps<"div"> {
  value: number;
  max?: number;
  label: string;
}

/**
 * A determinate progress bar. `label` is required because a bare bar conveys
 * nothing to a screen reader, and `aria-valuetext` restates the figure in words.
 */
function Progress({ className, value, max = 100, label, ...props }: ProgressProps) {
  const safeMax = max > 0 ? max : 1;
  const percent = Math.min(100, Math.max(0, (value / safeMax) * 100));

  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${label}: ${value} of ${max}`}
      aria-label={label}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export { Progress };
