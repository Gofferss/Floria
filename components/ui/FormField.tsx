type FormFieldProps = {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
};

export function FormField({ label, htmlFor, required, error, hint, children }: FormFieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block font-display text-sm font-medium text-ink">
        {label}
        {required && <span className="text-gold-600"> *</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 font-body text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 font-body text-xs text-ink/50">{hint}</p>
      ) : null}
    </div>
  );
}
