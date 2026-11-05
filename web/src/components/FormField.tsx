import { cloneElement, type ReactElement } from 'react';

/**
 * A labelled control with an optional error. The error sits outside the <label> (so it is not read
 * as part of the field's name) and is linked to the control with aria-describedby / aria-invalid.
 */
export function FormField({
  id,
  label,
  error,
  className = 'field',
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  className?: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="field-wrap">
      <label className={className}>
        <span>{label}</span>
        {cloneElement(children, {
          'aria-invalid': error ? true : undefined,
          'aria-describedby': error ? errorId : undefined,
        })}
      </label>
      {error && (
        <span className="error-text" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}
