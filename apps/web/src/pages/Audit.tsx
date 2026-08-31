import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';

export function AuditPage() {
  const q = useQuery({
    queryKey: ['audit'],
    queryFn: () =>
      api<
        {
          id: string;
          occurred_at: string;
          action: string;
          actor_label: string;
          entity_type: string;
          entity_id: string;
        }[]
      >('/api/v1/audit'),
  });
  return (
    <section className="card">
      <ul>
        {(q.data ?? []).map((a) => (
          <li key={a.id}>
            <span className="when">{a.occurred_at.replace('T', ' ').slice(0, 16)}</span>
            <span>
              <strong>{a.action}</strong>
              <span className="note">
                {a.entity_type} {a.entity_id ?? ''}
              </span>
            </span>
            <span className="actor">{a.actor_label}</span>
          </li>
        ))}
      </ul>
      <style>{`
        .card { background:#fff; border:1px solid var(--border-subtle); border-radius:12px; overflow:hidden; }
        ul { list-style:none; margin:0; padding:0; }
        li { display:flex; gap:14px; padding:13px 18px; border-bottom:1px solid #f5f5f1; }
        .when { font-family:var(--font-mono); font-size:12px; color:var(--text-tertiary); white-space:nowrap; }
        .note { display:block; color:var(--text-secondary); font-size:13px; }
        .actor { margin-left:auto; font-size:12.5px; color:var(--text-tertiary); }
      `}</style>
    </section>
  );
}
