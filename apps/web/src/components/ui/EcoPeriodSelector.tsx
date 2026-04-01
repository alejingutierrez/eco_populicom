interface PeriodOption {
  label: string;
  value: string;
}

interface EcoPeriodSelectorProps {
  options: PeriodOption[];
  value: string;
  onChange: (value: string) => void;
}

export function EcoPeriodSelector({ options, value, onChange }: EcoPeriodSelectorProps) {
  return (
    <div className="eco-period-selector">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={`eco-period-option${opt.value === value ? ' active' : ''}`}
          onClick={() => onChange(opt.value)}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
