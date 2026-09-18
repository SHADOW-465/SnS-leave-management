import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  options: SelectOption[];
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  'aria-label'?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  icon?: ReactNode;
  size?: 'md' | 'sm';
  fullWidth?: boolean;
}

export function Select({
  value,
  defaultValue,
  options,
  onChange,
  placeholder = 'Select…',
  className = '',
  style,
  'aria-label': ariaLabel,
  disabled = false,
  required = false,
  name,
  id,
  icon,
  size = 'md',
  fullWidth = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState<string>(
    value !== undefined
      ? value
      : defaultValue !== undefined
        ? defaultValue
        : (options[0]?.value ?? ''),
  );

  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;

  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  // Sync internal state if controlled value changes
  useEffect(() => {
    if (isControlled) {
      setInternalValue(value);
    }
  }, [isControlled, value]);

  // Sync internal state if uncontrolled defaultValue changes
  useEffect(() => {
    if (!isControlled && defaultValue !== undefined) {
      setInternalValue(defaultValue);
    }
  }, [isControlled, defaultValue]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selectedOption = options.find((opt) => opt.value === currentValue);

  function handleSelect(val: string) {
    if (disabled) return;
    if (!isControlled) {
      setInternalValue(val);
    }
    onChange?.(val);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const currentIndex = options.findIndex((o) => o.value === currentValue);
      const nextIndex =
        e.key === 'ArrowDown'
          ? (currentIndex + 1) % options.length
          : (currentIndex - 1 + options.length) % options.length;
      const nextOpt = options[nextIndex];
      if (nextOpt && !nextOpt.disabled) {
        handleSelect(nextOpt.value);
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  }

  return (
    <div
      ref={containerRef}
      className={`custom-select-wrap ${fullWidth ? 'is-fullwidth' : ''} ${className}`.trim()}
      style={style}
    >
      {name ? (
        <>
          <input type="hidden" name={name} value={currentValue} />
          {required ? (
            <input
              type="text"
              value={currentValue}
              required
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              style={{
                position: 'absolute',
                opacity: 0,
                pointerEvents: 'none',
                width: 1,
                height: 1,
                margin: 0,
                border: 0,
                padding: 0,
                bottom: 0,
                left: '50%',
              }}
            />
          ) : null}
        </>
      ) : null}
      <button
        id={id}
        type="button"
        className={`custom-select-trigger ${size === 'sm' ? 'is-sm' : ''} ${open ? 'is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
      >
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {icon ? <span className="custom-select-icon">{icon}</span> : null}
          <span className="custom-select-label">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown size={14} className="custom-select-chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div ref={listboxRef} role="listbox" aria-label={ariaLabel} className="custom-select-menu">
          {options.map((opt) => {
            const isSelected = opt.value === currentValue;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                className={`custom-select-option ${isSelected ? 'is-selected' : ''}`}
                onClick={() => handleSelect(opt.value)}
              >
                <span className="custom-select-opt-label">{opt.label}</span>
                {isSelected ? (
                  <Check size={13} className="custom-select-check" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
