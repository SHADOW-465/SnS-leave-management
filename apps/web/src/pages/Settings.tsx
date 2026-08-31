import { cloneElement, useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, Skeleton } from '@sns/ui';
import { api, ApiError, can, type Me } from '../api.js';

type Rules = {
  entitlementHalfDays: number;
  accrualMethod: 'none' | 'monthly' | 'annual_grant';
  accrualCadenceMonths: number;
  midYearProrate: boolean;
  carryForwardCapHalfDays: number;
  carryForwardExpiryMonths: number;
  probationRestriction: 'none' | 'forbid' | 'limited';
  probationMaxHalfDays: number;
  halfDaysAllowed: boolean;
  minNoticeDays: number;
  maxConsecutiveDays: number;
  negativeBalanceAllowed: boolean;
  attachmentRequiredAfterHalfDays: number | null;
};

type Policy = {
  id: string;
  leave_type_id: string;
  code: string;
  name: string;
  version_no: number;
  rules_json: string;
  effective_from: string;
  published_at: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

export function SettingsPage({ me }: { me: Me }) {
  const readOnly = !can(me, 'leave.policy.manage');
  const q = useQuery({
    queryKey: ['policies'],
    queryFn: () => api<Policy[]>('/api/v1/policies'),
  });

  if (q.isPending) return <Skeleton />;
  if (q.isError) {
    return (
      <ErrorState
        title="Could not load leave rules"
        body="Check that the Leave OS server is running, then try again."
        onRetry={() => void q.refetch()}
      />
    );
  }

  // Highest version per leave type is the one in force.
  const latest = new Map<string, Policy>();
  for (const p of q.data) {
    const seen = latest.get(p.leave_type_id);
    if (!seen || p.version_no > seen.version_no) latest.set(p.leave_type_id, p);
  }
  const policies = [...latest.values()];

  return (
    <div className="page-stack">
      <section className="card card-flush">
        <div className="card-head">
          <div>
            <h2>Leave rules</h2>
            <p className="note" style={{ margin: '2px 0 0' }}>
              {readOnly
                ? 'You can view these rules. Changing them needs policy permission.'
                : 'Each save publishes a new version. Requests already submitted keep the version they were submitted under.'}
            </p>
          </div>
        </div>
        {policies.length === 0 ? (
          <EmptyState
            title="No leave types yet"
            body="Create a leave type before setting its rules."
          />
        ) : (
          <div className="policy-list">
            {policies.map((p) => (
              <PolicyEditor key={p.id} policy={p} readOnly={readOnly} />
            ))}
          </div>
        )}
      </section>
      <div className="two-col">
        <LeaveYearCard readOnly={readOnly} />
        <EmailCard />
      </div>
    </div>
  );
}

function PolicyEditor({ policy, readOnly }: { policy: Policy; readOnly: boolean }) {
  const qc = useQueryClient();
  const parsed = JSON.parse(policy.rules_json) as Rules;
  const [rules, setRules] = useState<Rules>(parsed);
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  // A newer version published elsewhere must not be silently overwritten by a stale form.
  useEffect(() => {
    setRules(JSON.parse(policy.rules_json) as Rules);
    setState('idle');
  }, [policy.rules_json]);

  const dirty = JSON.stringify(rules) !== policy.rules_json;

  function set<K extends keyof Rules>(key: K, value: Rules[K]) {
    setRules((r) => ({ ...r, [key]: value }));
    setState('idle');
    setError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setState('saving');
    setError(null);
    try {
      await api('/api/v1/policies', {
        method: 'POST',
        body: JSON.stringify({ leaveTypeId: policy.leave_type_id, effectiveFrom, rules }),
      });
      await qc.invalidateQueries({ queryKey: ['policies'] });
      await qc.invalidateQueries({ queryKey: ['home'] });
      await qc.invalidateQueries({ queryKey: ['leave-types'] });
      setState('saved');
    } catch (err) {
      setState('idle');
      setError(err instanceof ApiError ? err.message : 'Could not save these rules.');
    }
  }

  const days = (halfDays: number) => halfDays / 2;
  const toHalf = (d: number) => Math.round(d * 2);

  return (
    <form className="policy" onSubmit={(e) => void save(e)}>
      <button
        type="button"
        className="policy-head"
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Edit'} rules for ${policy.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          <strong>{policy.name}</strong>
          <span className="mono policy-code">{policy.code}</span>
        </span>
        <span className="note policy-summary">
          {rules.entitlementHalfDays > 0
            ? `${days(rules.entitlementHalfDays)} days a year`
            : 'No entitlement'}
          {' · '}v{policy.version_no}
          {' · '}
          {open ? 'Hide' : 'Edit'}
        </span>
      </button>

      {open ? (
        <div className="policy-body">
          <fieldset disabled={readOnly}>
            <legend>Entitlement and accrual</legend>
            <div className="fields">
              <Field label="Days a year" hint="Total entitlement for a full leave year.">
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={0.5}
                  value={days(rules.entitlementHalfDays)}
                  onChange={(e) => set('entitlementHalfDays', toHalf(Number(e.target.value)))}
                />
              </Field>
              <Field label="How it is granted" hint="Monthly accrual, or the whole amount at once.">
                <select
                  value={rules.accrualMethod}
                  onChange={(e) => set('accrualMethod', e.target.value as Rules['accrualMethod'])}
                >
                  <option value="annual_grant">All at the start of the year</option>
                  <option value="monthly">Accrues monthly</option>
                  <option value="none">Not granted automatically</option>
                </select>
              </Field>
              {rules.accrualMethod === 'monthly' ? (
                <Field label="Accrue every (months)" hint="1 means every month.">
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={rules.accrualCadenceMonths}
                    onChange={(e) => set('accrualCadenceMonths', Number(e.target.value))}
                  />
                </Field>
              ) : null}
              <Toggle
                label="Pro-rate for mid-year joiners"
                hint="Someone joining in July gets half a year's entitlement."
                checked={rules.midYearProrate}
                onChange={(v) => set('midYearProrate', v)}
              />
            </div>
          </fieldset>

          <fieldset disabled={readOnly}>
            <legend>Carry-forward</legend>
            <div className="fields">
              <Field
                label="Maximum days carried"
                hint="0 means nothing carries into the next year."
              >
                <input
                  type="number"
                  min={0}
                  max={200}
                  step={0.5}
                  value={days(rules.carryForwardCapHalfDays)}
                  onChange={(e) => set('carryForwardCapHalfDays', toHalf(Number(e.target.value)))}
                />
              </Field>
              <Field
                label="Carried days expire after (months)"
                hint="0 means carried days never expire."
              >
                <input
                  type="number"
                  min={0}
                  max={24}
                  value={rules.carryForwardExpiryMonths}
                  onChange={(e) => set('carryForwardExpiryMonths', Number(e.target.value))}
                />
              </Field>
            </div>
          </fieldset>

          <fieldset disabled={readOnly}>
            <legend>Probation</legend>
            <div className="fields">
              <Field label="During probation" hint="Applies until the probation end date.">
                <select
                  value={rules.probationRestriction}
                  onChange={(e) =>
                    set('probationRestriction', e.target.value as Rules['probationRestriction'])
                  }
                >
                  <option value="none">Allowed as normal</option>
                  <option value="limited">Allowed up to a limit</option>
                  <option value="forbid">Not allowed</option>
                </select>
              </Field>
              {rules.probationRestriction === 'limited' ? (
                <Field label="Limit during probation (days)" hint="Per request.">
                  <input
                    type="number"
                    min={0}
                    max={200}
                    step={0.5}
                    value={days(rules.probationMaxHalfDays)}
                    onChange={(e) => set('probationMaxHalfDays', toHalf(Number(e.target.value)))}
                  />
                </Field>
              ) : null}
            </div>
          </fieldset>

          <fieldset disabled={readOnly}>
            <legend>How it may be requested</legend>
            <div className="fields">
              <Toggle
                label="Allow half days"
                hint="Lets people take a morning or an afternoon."
                checked={rules.halfDaysAllowed}
                onChange={(v) => set('halfDaysAllowed', v)}
              />
              <Field label="Minimum notice (days)" hint="0 means it can be requested for today.">
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={rules.minNoticeDays}
                  onChange={(e) => set('minNoticeDays', Number(e.target.value))}
                />
              </Field>
              <Field label="Maximum consecutive days" hint="Longest single request allowed.">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={rules.maxConsecutiveDays}
                  onChange={(e) => set('maxConsecutiveDays', Number(e.target.value))}
                />
              </Field>
              <Toggle
                label="Allow going below zero"
                hint="Normally off. Used for unpaid leave, which is deducted from pay."
                checked={rules.negativeBalanceAllowed}
                onChange={(v) => set('negativeBalanceAllowed', v)}
              />
              <Toggle
                label="Require a document"
                hint="For example a medical certificate on longer sick leave."
                checked={rules.attachmentRequiredAfterHalfDays !== null}
                onChange={(v) => set('attachmentRequiredAfterHalfDays', v ? 6 : null)}
              />
              {rules.attachmentRequiredAfterHalfDays !== null ? (
                <Field label="Required from (days)" hint="Requests of this length or longer.">
                  <input
                    type="number"
                    min={0.5}
                    max={200}
                    step={0.5}
                    value={days(rules.attachmentRequiredAfterHalfDays)}
                    onChange={(e) =>
                      set('attachmentRequiredAfterHalfDays', toHalf(Number(e.target.value)))
                    }
                  />
                </Field>
              ) : null}
            </div>
          </fieldset>

          {readOnly ? null : (
            <div className="policy-actions">
              <Field label="Takes effect from" hint="Earlier requests are unaffected.">
                <input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  required
                />
              </Field>
              <div className="policy-buttons">
                {error ? (
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                ) : null}
                {state === 'saved' ? (
                  <p role="status" className="form-ok">
                    Published as version {policy.version_no + 1}.
                  </p>
                ) : null}
                <Button type="button" onClick={() => setRules(parsed)} disabled={!dirty}>
                  Discard changes
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!dirty || state === 'saving'}
                  aria-label={`Publish new rules for ${policy.name}`}
                >
                  {state === 'saving' ? 'Publishing…' : 'Publish new version'}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </form>
  );
}

/**
 * Explicit id/htmlFor rather than a wrapping label. A wrapped label left these
 * controls with no accessible name — screen readers announced the current value
 * instead of what the field is for.
 */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field-row">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {cloneElement(children, { id, 'aria-describedby': hint ? hintId : undefined })}
      {hint ? (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field-row field-toggle">
      <span className="toggle-line">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-describedby={hint ? hintId : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      </span>
      {hint ? (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function LeaveYearCard({ readOnly }: { readOnly: boolean }) {
  const qc = useQueryClient();
  const org = useQuery({
    queryKey: ['org'],
    queryFn: () =>
      api<{
        company: { leave_year_start_month: number; leave_year_start_day: number; timezone: string };
      }>('/api/v1/org'),
  });
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function changeYear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (
      !window.confirm(
        'Change the leave year start?\n\nNew periods will use the new boundary. Leave years already recorded are not re-partitioned, and existing balances are not moved.',
      )
    ) {
      return;
    }
    setState('saving');
    setError(null);
    try {
      await api('/api/v1/leave-year', {
        method: 'POST',
        body: JSON.stringify({
          startMonth: Number(fd.get('m')),
          startDay: Number(fd.get('d')),
          confirm: true,
        }),
      });
      await qc.invalidateQueries({ queryKey: ['org'] });
      setState('saved');
    } catch (err) {
      setState('idle');
      setError(err instanceof ApiError ? err.message : 'Could not change the leave year.');
    }
  }

  return (
    <section className="card">
      <h2>Leave year</h2>
      <p className="note">
        The date your leave year starts. Entitlement, carry-forward, and expiry all run from it.
      </p>
      {org.isPending ? (
        <Skeleton />
      ) : (
        <form onSubmit={(e) => void changeYear(e)} className="year-form">
          <fieldset disabled={readOnly}>
            <div className="fields">
              <Field label="Start month">
                <select name="m" defaultValue={org.data?.company.leave_year_start_month ?? 1}>
                  {[
                    'January',
                    'February',
                    'March',
                    'April',
                    'May',
                    'June',
                    'July',
                    'August',
                    'September',
                    'October',
                    'November',
                    'December',
                  ].map((label, i) => (
                    <option key={label} value={i + 1}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Start day">
                <input
                  name="d"
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={org.data?.company.leave_year_start_day ?? 1}
                />
              </Field>
            </div>
            {readOnly ? null : (
              <Button type="submit" disabled={state === 'saving'}>
                {state === 'saving' ? 'Saving…' : 'Change leave year'}
              </Button>
            )}
          </fieldset>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          {state === 'saved' ? (
            <p role="status" className="form-ok">
              Leave year updated.
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}

function EmailCard() {
  const email = useQuery({
    queryKey: ['email-preview'],
    queryFn: () =>
      api<{
        to: string;
        subject: string;
        heading: string;
        body: string;
        rows: { k: string; v: string }[];
      }>('/api/v1/email/preview'),
  });
  return (
    <section className="card">
      <h2>Notification email</h2>
      <p className="note">
        Sent to approvers when a request needs a decision. The link opens the request after signing
        in — it cannot approve anything on its own. In-app notifications work whether or not email
        is delivered.
      </p>
      {email.isPending ? <Skeleton /> : null}
      {email.data ? (
        <div className="email-preview">
          <p className="email-subject">{email.data.subject}</p>
          <p className="note" style={{ margin: 0 }}>
            {email.data.body}
          </p>
          <dl className="summary-dl">
            {email.data.rows.map((r) => (
              <div key={r.k} style={{ display: 'contents' }}>
                <dt>{r.k}</dt>
                <dd>{r.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
