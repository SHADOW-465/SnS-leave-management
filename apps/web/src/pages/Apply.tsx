import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@sns/ui';
import { api, ApiError, type Me } from '../api.js';

export function ApplyPage({ me }: { me: Me }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const types = useQuery({
    queryKey: ['types'],
    queryFn: () => api<{ id: string; name: string; code: string }[]>('/api/v1/leave-types'),
  });
  const [leaveTypeId, setType] = useState('');
  const [startDate, setFrom] = useState('');
  const [endDate, setTo] = useState('');
  const [duration, setDur] = useState<'full' | 'am' | 'pm'>('full');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const typeId = leaveTypeId || types.data?.[0]?.id || '';

  const previewQ = useMemo(() => {
    if (!typeId || !startDate || !endDate) return '';
    const p = new URLSearchParams({ leaveTypeId: typeId, startDate, endDate });
    if (duration !== 'full') p.set('halfDayStart', duration);
    return `/api/v1/leave/preview?${p.toString()}`;
  }, [typeId, startDate, endDate, duration]);

  const preview = useQuery({
    queryKey: ['preview', previewQ],
    queryFn: () =>
      api<{
        workingDays: string;
        skipped: string;
        after: string;
        overlaps: { name: string; when: string }[];
        approver: string;
      }>(previewQ),
    enabled: Boolean(previewQ),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/v1/leave-requests', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          leaveTypeId: typeId,
          startDate,
          endDate,
          halfDayStart: duration === 'full' ? null : duration,
          reason,
          attachmentId: fileId,
        }),
      });
      await qc.invalidateQueries();
      void nav('/requests');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit.');
    }
  }

  async function onFile(f: File | null) {
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    const res = await api<{ id: string }>('/api/v1/attachments', { method: 'POST', body: fd });
    setFileId(res.id);
  }

  return (
    <section className="apply-grid">
      <form onSubmit={(e) => void onSubmit(e)} className="card form">
        {error ? (
          <p role="alert" style={{ color: 'var(--status-rejected-fg)' }}>
            {error}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor="f-type">Leave type</label>
          <select
            id="f-type"
            className="select"
            value={typeId}
            onChange={(e) => setType(e.target.value)}
          >
            {(types.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="f-from">From</label>
            <input
              id="f-from"
              className="input"
              type="date"
              value={startDate}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="f-to">To</label>
            <input
              id="f-to"
              className="input"
              type="date"
              value={endDate}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </div>
        </div>
        <fieldset>
          <legend>Duration</legend>
          {(
            [
              ['full', 'Full day'],
              ['am', 'Half day — morning'],
              ['pm', 'Half day — afternoon'],
            ] as const
          ).map(([d, label]) => (
            // Explicit id/htmlFor rather than a wrapping label: the wrapped form left
            // these radios with no accessible name, so a screen reader announced "on".
            <div key={d} className="inline-opt">
              <input
                id={`dur-${d}`}
                type="radio"
                name="dur"
                value={d}
                checked={duration === d}
                onChange={() => setDur(d)}
              />
              <label htmlFor={`dur-${d}`}>{label}</label>
            </div>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="f-reason">Reason</label>
          <textarea
            id="f-reason"
            className="textarea"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={3}
          />
        </div>
        <div className="field">
          <label htmlFor="f-file">Attachment (if the policy requires it)</label>
          <input
            id="f-file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="primary" type="submit">
            Submit request
          </Button>
          <Button type="button" onClick={() => void nav('/')}>
            Cancel
          </Button>
        </div>
        <p className="note">
          Submitting waits for the server. The request is not shown as sent until it is saved.
        </p>
      </form>
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card">
          <h2 style={{ margin: '0 0 12px', fontSize: 14.5 }}>Request summary</h2>
          <dl className="summary-dl">
            <dt>Working days</dt>
            <dd>{preview.data?.workingDays ?? '—'}</dd>
            <dt>Holidays skipped</dt>
            <dd>{preview.data?.skipped ?? '—'}</dd>
            <dt>Balance after</dt>
            <dd>{preview.data?.after ?? '—'}</dd>
            <dt>Goes to</dt>
            <dd>{preview.data?.approver ?? 'Working it out…'}</dd>
          </dl>
        </div>
        <div className="card">
          <h2 style={{ margin: '0 0 12px', fontSize: 14.5 }}>Who else is out</h2>
          {(preview.data?.overlaps ?? []).length === 0 ? (
            <p className="note">No overlaps in range.</p>
          ) : null}
          <ul>
            {(preview.data?.overlaps ?? []).map((o) => (
              <li key={o.name + o.when}>
                <strong>{o.name}</strong> <span className="note">{o.when}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="note">Signed in as {me.displayName}.</p>
      </aside>
    </section>
  );
}
