import { Button } from "@/components/ui/button.tsx";

export interface RankableApplication {
  applicationId: string;
  committeeName: string;
}

export interface PreferenceRankingProps {
  order: RankableApplication[];
  onMove: (applicationId: string, direction: -1 | 1) => void;
  onSave: () => void;
  isSaving: boolean;
  isDirty: boolean;
}

/** "1st choice", "2nd choice", and so on, spelled out rather than implied. */
function ordinal(position: number): string {
  const suffix =
    position % 100 >= 11 && position % 100 <= 13
      ? "th"
      : position % 10 === 1
        ? "st"
        : position % 10 === 2
          ? "nd"
          : position % 10 === 3
            ? "rd"
            : "th";
  return `${position}${suffix} choice`;
}

/**
 * The applicant's order of preference.
 *
 * **Move buttons, not drag handles.** Some cycles require a ranking before an
 * application can be submitted, and a ranking that can only be expressed by
 * dragging cannot be expressed at all by somebody who does not use a pointer.
 * Each button names the committee it moves, so the label still makes sense read
 * on its own out of a list of controls.
 *
 * The position is in the text as well as in the vertical order, because
 * vertical order is not conveyed to a screen reader reading one row at a time.
 */
export function PreferenceRanking(props: PreferenceRankingProps) {
  return (
    <section aria-labelledby="preference-order" className="mt-12 max-w-[62ch]">
      <h2 id="preference-order" className="text-lg font-semibold">
        Your order of preference
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        This cycle asks you to rank the committees you applied to. Put the one you most want first.
        Every committee you applied to is included, because leaving one out would read as putting it
        last.
      </p>

      <ul aria-label="Your order of preference" className="mt-4 space-y-2">
        {props.order.map((row, index) => (
          <li
            key={row.applicationId}
            className="flex items-center justify-between gap-3 rounded-[8px] border border-border bg-card px-4 py-3"
          >
            <span className="min-w-0">
              <span className="text-sm font-medium">{row.committeeName}</span>
              <span className="ml-2 text-xs text-muted-foreground">{ordinal(index + 1)}</span>
            </span>
            <span className="flex shrink-0 gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={index === 0}
                onClick={() => props.onMove(row.applicationId, -1)}
              >
                {`Move ${row.committeeName} up`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={index === props.order.length - 1}
                onClick={() => props.onMove(row.applicationId, 1)}
              >
                {`Move ${row.committeeName} down`}
              </Button>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={props.onSave} disabled={props.isSaving}>
          {props.isSaving ? "Saving…" : "Save my order"}
        </Button>
        {/*
          Said out loud, because an order that looks right on screen but was
          never sent is the failure this page can produce silently.
        */}
        <span aria-live="polite" className="text-sm text-muted-foreground">
          {props.isDirty ? "Not saved yet." : ""}
        </span>
      </div>
    </section>
  );
}
