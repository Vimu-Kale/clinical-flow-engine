import type { ReactNode } from 'react';

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className="input"
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
}) {
  return (
    <input
      className="input"
      type="number"
      min={min}
      value={value ?? ''}
      onChange={(event) => {
        const raw = event.target.value;
        onChange(raw === '' ? undefined : Number(raw));
      }}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 3,
  mono,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  mono?: boolean;
}) {
  return (
    <textarea
      className={mono ? 'input input--mono' : 'input'}
      rows={rows}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
