import type { ReactNode } from 'react';

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ padding: 32, textAlign: 'center', maxWidth: 420, margin: '0 auto' }}>
      <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{title}</p>
      <p className="note" style={{ marginTop: 8 }}>
        {body}
      </p>
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}
