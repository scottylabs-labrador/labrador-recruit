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
