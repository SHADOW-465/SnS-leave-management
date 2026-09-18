import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button, Select } from '@sns/ui';
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

  const canApplyForOthers = Boolean(
    me.permissions.some(
      (p) => p.startsWith('leave.request.create:') && p !== 'leave.request.create:self',
    ) ||
    me.roles.includes('manager') ||
    me.roles.includes('hr_officer') ||
    me.roles.includes('admin'),
  );

  const [applyMode, setApplyMode] = useState<'myself' | 'other'>('myself');
  const [targetEmployeeId, setTargetEmployeeId] = useState<string>('');

  const employeesQ = useQuery({
    queryKey: ['employees-for-apply'],
    queryFn: () =>
      api<
        {
          id: string;
          first_name: string;
          last_name: string;
          employee_code: string;
          department_name?: string;
          team_name?: string;
          status?: string;
        }[]
      >('/api/v1/employees'),
    enabled: canApplyForOthers,
  });

  const otherEmployees = useMemo(() => {
    return (employeesQ.data ?? [])
      .filter((e) => e.status !== 'exited' && e.id !== me.employeeId)
      .map((e) => ({
        value: e.id,
        label: `${e.first_name} ${e.last_name} (${e.employee_code}) — ${e.team_name || e.department_name || 'Staff'}`,
      }));
  }, [employeesQ.data, me.employeeId]);

  const activeEmployeeId = applyMode === 'other' ? targetEmployeeId : undefined;

  const previewQ = useMemo(() => {
    if (!typeId || !startDate || !endDate) return '';
    const p = new URLSearchParams({ leaveTypeId: typeId, startDate, endDate });
    if (duration !== 'full') p.set('halfDayStart', duration);
    if (activeEmployeeId) p.set('employeeId', activeEmployeeId);
    return `/api/v1/leave/preview?${p.toString()}`;
  }, [typeId, startDate, endDate, duration, activeEmployeeId]);

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
          employeeId: activeEmployeeId || undefined,
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
        {canApplyForOthers ? (
          <div className="field" style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
              Applying For
            </label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Button
                variant={applyMode === 'myself' ? 'primary' : 'secondary'}
                size="sm"
                type="button"
                onClick={() => {
                  setApplyMode('myself');
                  setTargetEmployeeId('');
                }}
              >
                Myself ({me.displayName})
              </Button>
              <Button
                variant={applyMode === 'other' ? 'primary' : 'secondary'}
                size="sm"
                type="button"
                onClick={() => {
                  setApplyMode('other');
                  const first = otherEmployees[0];
                  if (!targetEmployeeId && first) {
                    setTargetEmployeeId(first.value);
                  }
                }}
              >
                On Behalf of Team Member
              </Button>
            </div>
            {applyMode === 'other' ? (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Select
                  id="f-target-emp"
                  name="targetEmployeeId"
                  value={targetEmployeeId}
                  onChange={(val) => setTargetEmployeeId(val)}
                  fullWidth
                  options={otherEmployees}
                />
                <p className="note" style={{ color: 'var(--accent, #3b82f6)', margin: '4px 0 0' }}>
                  ℹ️ Submitting sudden/uninformed leave on behalf of an absent team member. You will
                  be recorded as the submitter, and the employee will be notified.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="f-type">Leave type</label>
          <Select
            id="f-type"
            name="leaveTypeId"
            value={typeId}
            onChange={(val) => setType(val)}
            fullWidth
            options={(types.data ?? []).map((t) => ({
              value: t.id,
              label: t.name,
            }))}
          />
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
