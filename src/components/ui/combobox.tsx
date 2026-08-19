"use client";

import * as React from "react";
import { Combobox } from "@base-ui/react/combobox";
import { cn } from "@/lib/utils";

export type ComboboxOption = { value: string; label: string };

/**
 * A searchable dropdown — same role as a native <select>, but the option
 * list filters as you type instead of requiring a scroll through every
 * entry. Built on @base-ui/react's Combobox (already a dependency,
 * unused elsewhere in the app) rather than a hand-rolled input+list, so
 * keyboard navigation, ARIA and popup positioning come for free.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  emptyOptionLabel = "—",
  className,
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyOptionLabel?: string;
  className?: string;
}) {
  const items = React.useMemo<ComboboxOption[]>(
    () => [{ value: "", label: emptyOptionLabel }, ...options],
    [options, emptyOptionLabel],
  );
  const selected = items.find((i) => i.value === value) ?? null;

  return (
    <Combobox.Root
      items={items}
      value={selected}
      onValueChange={(next) => onChange(next?.value ?? "")}
      isItemEqualToValue={(item, compare) => item.value === compare.value}
    >
      <Combobox.Input
        placeholder={placeholder}
        // Selects the current label on focus so typing replaces it
        // outright — without this, a click anywhere but the very start
        // or end of the text drops the cursor mid-label and typing
        // splices into it instead of searching.
        onFocus={(e) => e.currentTarget.select()}
        className={cn("h-8 w-full rounded-md border px-2 text-sm", className)}
      />
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50">
          <Combobox.Popup className="max-h-60 w-[var(--anchor-width)] overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
            <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground">No matches</Combobox.Empty>
            <Combobox.List>
              {(item: ComboboxOption) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className={(state) =>
                    cn(
                      "cursor-pointer rounded-sm px-2 py-1.5",
                      state.highlighted && "bg-accent text-accent-foreground",
                    )
                  }
                >
                  {item.label}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
