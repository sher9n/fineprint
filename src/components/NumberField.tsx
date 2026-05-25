"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface NumberFieldProps {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: string | number;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

/**
 * A controlled number input that holds the editing state as a string so the
 * user can freely delete the value, type leading zeros, etc., without React
 * snapping the field back to "0" on every keystroke. Commits the parsed number
 * upstream as soon as the string parses to a finite number.
 */
export function NumberField({ value, onChange, min, max, step, className, disabled, placeholder, ariaLabel }: NumberFieldProps) {
  const [text, setText] = useState<string>(() => String(value));
  const lastUpstream = useRef<number>(value);

  useEffect(() => {
    // Only resync if the upstream number actually changed (parent reset / saved)
    if (value !== lastUpstream.current) {
      lastUpstream.current = value;
      setText(String(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      pattern="[0-9]*\.?[0-9]*"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        // Allow empty, a single minus, or numeric-looking strings while editing
        if (raw === "" || raw === "-" || /^-?\d*\.?\d*$/.test(raw)) {
          setText(raw);
          const n = parseFloat(raw);
          if (Number.isFinite(n)) {
            lastUpstream.current = n;
            onChange(n);
          }
        }
      }}
      onBlur={() => {
        // Normalize display on blur: if empty / invalid, snap to last committed value
        const n = parseFloat(text);
        if (!Number.isFinite(n)) {
          setText(String(lastUpstream.current));
        } else {
          let clamped = n;
          if (min != null && clamped < min) clamped = min;
          if (max != null && clamped > max) clamped = max;
          if (clamped !== n || /^0\d/.test(text)) {
            setText(String(clamped));
            lastUpstream.current = clamped;
            onChange(clamped);
          } else {
            // Strip trailing dots or leading zeros without changing the number
            setText(String(n));
          }
        }
      }}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-step={step}
      className={cn("input mono", className)}
    />
  );
}
