import { Label, Select } from "@/components/ui/field.tsx";
import type { CommitteeSummary } from "@/lib/recruitment.ts";

interface CommitteePickerProps {
  id: string;
  committees: CommitteeSummary[];
  value: string;
  onChange: (committeeId: string) => void;
  label?: string;
}

export function CommitteePicker({
  id,
  committees,
  value,
  onChange,
  label = "Committee",
}: CommitteePickerProps) {
  // A cycle pinned to one committee leaves a select with a single option,
  // which reads as a choice the reader does not have. Name the committee
  // instead, so the screen still says which one they are looking at.
  const only = committees.length === 1 ? committees[0] : undefined;
  if (only !== undefined) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{only.name}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        className="w-56"
        value={value}
        disabled={committees.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {committees.length === 0 ? <option value="">No committees</option> : null}
        {committees.map((committee) => (
          <option key={committee.id} value={committee.id}>
            {committee.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
