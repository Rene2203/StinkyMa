import { formatAddress, type EmailAddress } from "@stinkyma/core";
import { forwardRef, useEffect, useId, useState, type KeyboardEvent } from "react";
import { useUi } from "../context.js";

/** Teil der Eingabe, der gerade getippt wird (nach dem letzten Komma/Semikolon außerhalb von Anführungszeichen). */
export function currentToken(value: string): { start: number; text: string } {
  let quoted = false;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') quoted = !quoted;
    else if ((char === "," || char === ";") && !quoted) start = i + 1;
  }
  return { start, text: value.slice(start).trim() };
}

/** Ersetzt den gerade getippten Teil durch die gewählte Adresse und hängt „, “ an. */
export function acceptSuggestion(value: string, address: EmailAddress): string {
  const { start } = currentToken(value);
  const before = value.slice(0, start).replace(/\s*$/, "");
  return `${before ? `${before} ` : ""}${formatAddress(address)}, `;
}

/**
 * Empfängerfeld mit Vorschlägen: tippen → Liste passender Kontakte, ↑/↓ wählen, Enter oder Tab übernehmen,
 * Esc schließt nur die Liste (nicht das Mail-Fenster).
 */
export const AddressInput = forwardRef<HTMLInputElement, {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId: string;
  label: string;
}>(function AddressInput({ value, onChange, placeholder, testId, label }, ref) {
  const { store } = useUi();
  const listId = useId();
  const [suggestions, setSuggestions] = useState<EmailAddress[]>([]);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const token = currentToken(value).text;

  useEffect(() => {
    if (!focused || token.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void store.suggestAddresses(token).then((list) => {
        if (!cancelled) {
          setSuggestions(list);
          setActive(0);
        }
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, focused, store]);

  const open = suggestions.length > 0;
  const choose = (address: EmailAddress) => {
    onChange(acceptSuggestion(value, address));
    setSuggestions([]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const pick = suggestions[active];
      if (!pick || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      choose(pick);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setSuggestions([]);
    }
  };

  return (
    <span className="address-input">
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        aria-label={label}
        data-testid={testId}
        data-suggesting={open ? "true" : undefined}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {open && (
        <ul className="address-suggestions" id={listId} role="listbox" data-testid="address-suggestions">
          {suggestions.map((s, i) => (
            <li
              key={s.address}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              // mousedown statt click: sonst verliert das Feld vorher den Fokus und die Liste verschwindet
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
            >
              {s.name && <strong>{s.name}</strong>}
              <span className="muted">{s.address}</span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
});
