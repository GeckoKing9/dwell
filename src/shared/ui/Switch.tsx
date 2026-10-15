interface SwitchProps {
  id: string;
  checked: boolean;
  /** Id of the visible element that names the switch. */
  labelledBy: string;
  onChange(next: boolean): void;
}

/** One tap, no confirmation: the switch reports the flipped value and the caller sends it on. */
export function Switch({ id, checked, labelledBy, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      id={id}
      class="switch"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
    />
  );
}
