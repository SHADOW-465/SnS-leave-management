export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="page" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="kpi-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card">
            <div className="skel" style={{ height: 12, width: '40%' }} />
            <div className="skel" style={{ height: 28, width: '55%', marginTop: 12 }} />
            <div className="skel" style={{ height: 6, marginTop: 16 }} />
          </div>
        ))}
      </div>
      <div className="card">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skel" style={{ height: 14, marginBottom: 12 }} />
        ))}
      </div>
    </div>
  );
}
