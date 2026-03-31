export function TelemetryCard({
  label,
  value,
  low,
}: {
  label: string;
  value: string;
  low?: boolean;
}) {
  return (
    <div className="telemetry-card">
      <p className="telemetry-label">{label}</p>
      <p className={`telemetry-value ${low ? 'telemetry-low' : ''}`}>{value}</p>
    </div>
  );
}
