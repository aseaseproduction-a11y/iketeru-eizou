import { Check, Plus, X } from "lucide-react";
import React, { useId, useState } from "react";

type MetadataValuePickerProps = {
  label: string;
  values: string[];
  suggestions: readonly string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  allowCustom?: boolean;
};

export default function MetadataValuePicker({
  label,
  values,
  suggestions,
  onChange,
  placeholder,
  allowCustom = true,
}: MetadataValuePickerProps) {
  const [draft, setDraft] = useState("");
  const selectId = useId();
  const addValue = (rawValue: string) => {
    const value = rawValue.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
  };
  const addDraft = () => {
    addValue(draft);
    setDraft("");
  };
  const availableSuggestions = suggestions.filter((value) => !values.includes(value));

  return (
    <div>
      <label htmlFor={selectId} className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2 focus-within:ring-1 focus-within:ring-cinematic-red/40">
        {values.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {values.map((value) => (
              <span key={value} className="inline-flex items-center gap-1 rounded-md bg-cinematic-red/10 px-2 py-1 text-[11px] text-cinematic-red">
                <Check className="h-3 w-3" />
                {value}
                <button type="button" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`${label}の${value}を削除`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <select
          id={selectId}
          value=""
          onChange={(event) => addValue(event.target.value)}
          aria-label={`${label}の既存値を選択`}
          className="w-full rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-cinematic-red/40"
        >
          <option value="" disabled>{availableSuggestions.length > 0 ? "登録済みの候補から追加（複数可）" : "追加できる登録済み候補はありません"}</option>
          {availableSuggestions.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        {allowCustom && (
          <div className="mt-2 flex gap-2 border-t border-white/[0.08] pt-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addDraft();
                }
              }}
              aria-label={`${label}を手入力`}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent px-1 py-1 text-xs outline-none placeholder:text-muted-foreground/45"
            />
            <button type="button" onClick={addDraft} className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 text-xs text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground">
              <Plus className="h-3 w-3" />追加
            </button>
          </div>
        )}
      </div>
      {allowCustom ? <p className="mt-1 text-[10px] text-muted-foreground/65">候補にない値だけ手入力で追加できます。</p> : <p className="mt-1 text-[10px] text-muted-foreground/65">許容済みの選択肢から複数追加できます。</p>}
    </div>
  );
}
