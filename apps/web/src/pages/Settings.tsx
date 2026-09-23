import { cloneElement, useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, Select, Skeleton } from '@sns/ui';
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
  excludeWeekends: boolean;
  excludeHolidays: boolean;
  joinMonthAccrual: 'full' | 'prorated' | 'none';
  categoryMonthlyHalfDays: Record<string, number>;
  probationMonthlyHalfDays: number | null;
  maxBalanceHalfDays: number;
  confirmedTenureYears?: number;
  confirmedUnderMonthlyHalfDays?: number | null;
  confirmedFromMonthlyHalfDays?: number | null;
  probationExperiencedMonthlyHalfDays?: number | null;
  probationFresherMonthlyHalfDays?: number | null;
  lossOfPayOnShortfall?: boolean;
};

/** Versions published before a setting existed lack it; fill the same defaults the server uses. */
function normalise(json: string): Rules {
  const raw = JSON.parse(json) as Partial<Rules>;
  return {
    excludeWeekends: true,
    excludeHolidays: true,
    joinMonthAccrual: 'prorated',
    probationMonthlyHalfDays: null,
    maxBalanceHalfDays: 0,
    lossOfPayOnShortfall: raw.lossOfPayOnShortfall ?? true,
    ...raw,
    categoryMonthlyHalfDays: raw.categoryMonthlyHalfDays ?? {},
  } as Rules;
}

type Org = {
  company: { leave_year_start_month: number; leave_year_start_day: number; timezone: string };
  employmentTypes: { id: string; code: string; name: string }[];
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
            <h2>Leave configuration</h2>
            <p className="note" style={{ margin: '2px 0 0' }}>
              {readOnly
                ? 'You can view these rules. Changing them needs policy permission.'
                : 'Each save publishes a new version. Requests already submitted keep the version they were submitted under. Add, rename or archive leave types on Leave types.'}
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
        <WorkWeekCard readOnly={readOnly} />
        <StaffCategoriesCard readOnly={!can(me, 'org.structure.manage')} />
      </div>
      <div className="two-col">
        <LeaveYearCard readOnly={readOnly} />
        <EmailCard />
      </div>
    </div>
  );
}

function PolicyEditor({ policy, readOnly }: { policy: Policy; readOnly: boolean }) {
  const qc = useQueryClient();
  const parsed = normalise(policy.rules_json);
  const [rules, setRules] = useState<Rules>(parsed);
  const org = useQuery({ queryKey: ['org'], queryFn: () => api<Org>('/api/v1/org') });
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  // A newer version published elsewhere must not be silently overwritten by a stale form.
  useEffect(() => {
    setRules(normalise(policy.rules_json));
    setState('idle');
  }, [policy.rules_json]);

  const dirty = JSON.stringify(rules) !== JSON.stringify(parsed);

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
          {rules.entitlementHalfDays <= 0
            ? 'No entitlement'
            : rules.accrualMethod === 'monthly'
              ? `${days(Math.round(rules.entitlementHalfDays / 12))} days a month · ${days(rules.entitlementHalfDays)} a year`
              : `${days(rules.entitlementHalfDays)} days a year`}
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
              {rules.accrualMethod === 'monthly' ? (
                <Field
                  label="Credited each month (days)"
                  hint={`Standard rate. ${days(rules.entitlementHalfDays)} days over a full year.`}
                >
                  <input
                    type="number"
                    min={0}
                    max={31}
                    step={0.5}
                    value={days(Math.round(rules.entitlementHalfDays / 12))}
                    onChange={(e) =>
                      set('entitlementHalfDays', toHalf(Number(e.target.value)) * 12)
                    }
                  />
                </Field>
              ) : (
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
              )}
              <Field label="How it is granted" hint="Monthly accrual, or the whole amount at once.">
                <Select
                  value={rules.accrualMethod}
                  onChange={(val) => set('accrualMethod', val as Rules['accrualMethod'])}
                  fullWidth
                  disabled={readOnly}
                  options={[
                    { value: 'annual_grant', label: 'All at the start of the year' },
                    { value: 'monthly', label: 'Accrues monthly' },
                    { value: 'none', label: 'Not granted automatically' },
                  ]}
                />
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
              {rules.accrualMethod === 'monthly' ? (
                <Field
                  label="Month someone joins"
                  hint="Joining on the 15th of a 30-day month: pro-rated gives half the month's credit."
                >
                  <Select
                    value={rules.joinMonthAccrual}
                    onChange={(val) => set('joinMonthAccrual', val as Rules['joinMonthAccrual'])}
                    fullWidth
                    disabled={readOnly}
                    options={[
                      { value: 'prorated', label: 'Pro-rated for the days worked' },
                      { value: 'full', label: 'Full month’s credit' },
                      { value: 'none', label: 'Nothing until the next month' },
                    ]}
                  />
                </Field>
              ) : (
                <Toggle
                  label="Pro-rate for mid-year joiners"
                  hint="Someone joining in July gets half a year's entitlement."
                  checked={rules.midYearProrate}
                  onChange={(v) => set('midYearProrate', v)}
                />
              )}
              <Field
                label="Maximum balance (days)"
                hint="Credits stop once someone holds this much. 0 means no limit."
              >
                <input
                  type="number"
                  min={0}
                  max={400}
                  step={0.5}
                  value={days(rules.maxBalanceHalfDays)}
                  onChange={(e) => set('maxBalanceHalfDays', toHalf(Number(e.target.value)))}
                />
              </Field>
            </div>
          </fieldset>

          {rules.accrualMethod === 'monthly' ? (
            <fieldset disabled={readOnly}>
              <legend>Monthly credit by staff category</legend>
              <p className="field-hint" style={{ margin: '0 0 10px' }}>
                Leave a category blank to use the standard rate. Categories are managed below, and
                each employee's category is set on their record.
              </p>
              <div className="fields">
                {(org.data?.employmentTypes ?? []).map((t) => {
                  const v = rules.categoryMonthlyHalfDays[t.code];
                  return (
                    <Field key={t.code} label={`${t.name} (days a month)`} hint={`Code ${t.code}`}>
                      <input
                        type="number"
                        min={0}
                        max={31}
                        step={0.5}
                        placeholder={String(days(Math.round(rules.entitlementHalfDays / 12)))}
                        value={v == null ? '' : days(v)}
                        onChange={(e) => {
                          const next = { ...rules.categoryMonthlyHalfDays };
                          if (e.target.value === '') delete next[t.code];
                          else next[t.code] = toHalf(Number(e.target.value));
                          set('categoryMonthlyHalfDays', next);
                        }}
                      />
                    </Field>
                  );
                })}
                <Field
                  label="Confirmed, under 3 years (days a month)"
                  hint="Blank uses 1.5 for Annual Leave. Applies after probation."
                >
                  <input
                    type="number"
                    min={0}
                    max={31}
                    step={0.5}
                    value={
                      rules.confirmedUnderMonthlyHalfDays == null
                        ? ''
                        : days(rules.confirmedUnderMonthlyHalfDays)
                    }
                    onChange={(e) =>
                      set(
                        'confirmedUnderMonthlyHalfDays',
                        e.target.value === '' ? null : toHalf(Number(e.target.value)),
                      )
                    }
                  />
                </Field>
                <Field
                  label="Confirmed, 3 years or more (days a month)"
                  hint="Blank uses 2 for Annual Leave."
                >
                  <input
                    type="number"
                    min={0}
                    max={31}
                    step={0.5}
                    value={
                      rules.confirmedFromMonthlyHalfDays == null
                        ? ''
                        : days(rules.confirmedFromMonthlyHalfDays)
                    }
                    onChange={(e) =>
                      set(
                        'confirmedFromMonthlyHalfDays',
                        e.target.value === '' ? null : toHalf(Number(e.target.value)),
                      )
                    }
                  />
                </Field>
                <Field
                  label="Probation, experienced hire (days a month)"
                  hint="Blank uses 1 for Annual Leave."
                >
                  <input
                    type="number"
                    min={0}
                    max={31}
                    step={0.5}
                    value={
                      rules.probationExperiencedMonthlyHalfDays == null
                        ? ''
                        : days(rules.probationExperiencedMonthlyHalfDays)
                    }
                    onChange={(e) =>
                      set(
                        'probationExperiencedMonthlyHalfDays',
                        e.target.value === '' ? null : toHalf(Number(e.target.value)),
                      )
                    }
                  />
                </Field>
                <Field
                  label="Probation, fresher (days a month)"
                  hint="Blank uses 0 for Annual Leave. Mark the person as a fresher on their record."
                >
                  <input
                    type="number"
                    min={0}
                    max={31}
                    step={0.5}
                    value={
                      rules.probationFresherMonthlyHalfDays == null
                        ? ''
                        : days(rules.probationFresherMonthlyHalfDays)
                    }
                    onChange={(e) =>
                      set(
                        'probationFresherMonthlyHalfDays',
                        e.target.value === '' ? null : toHalf(Number(e.target.value)),
                      )
                    }
                  />
                </Field>
                <Field
                  label="While on probation (days a month)"
                  hint="Older single rate. Blank lets the experienced and fresher rates apply."
                >
                  <input
                    type="number"
                    min={0}
                    max={31}
                    step={0.5}
                    value={
                      rules.probationMonthlyHalfDays == null
                        ? ''
                        : days(rules.probationMonthlyHalfDays)
                    }
                    onChange={(e) =>
                      set(
                        'probationMonthlyHalfDays',
                        e.target.value === '' ? null : toHalf(Number(e.target.value)),
                      )
                    }
                  />
                </Field>
              </div>
            </fieldset>
          ) : null}

          <fieldset disabled={readOnly}>
            <legend>Counting days</legend>
            <div className="fields">
              <Toggle
                label="Shortfall is loss of pay"
                hint="Leave beyond the earned balance is allowed. The extra days are shown as loss of pay and the employee is told."
                checked={rules.lossOfPayOnShortfall !== false}
                onChange={(v) => set('lossOfPayOnShortfall', v)}
              />
              <Toggle
                label="Weekends are not counted"
                hint="Leave from Friday to Monday counts 2 days, not 4. The weekend itself is set under Working week."
                checked={rules.excludeWeekends}
                onChange={(v) => set('excludeWeekends', v)}
              />
              <Toggle
                label="Government holidays are not counted"
                hint="Public holidays on the holiday calendar inside a request are free."
                checked={rules.excludeHolidays}
                onChange={(v) => set('excludeHolidays', v)}
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
                <Select
                  value={rules.probationRestriction}
                  onChange={(val) =>
                    set('probationRestriction', val as Rules['probationRestriction'])
                  }
                  fullWidth
                  disabled={readOnly}
                  options={[
                    { value: 'none', label: 'Allowed as normal' },
                    { value: 'limited', label: 'Allowed up to a limit' },
                    { value: 'forbid', label: 'Not allowed' },
                  ]}
                />
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

function WorkWeekCard({ readOnly }: { readOnly: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['work-week'],
    queryFn: () => api<{ weekendDays: number[] }>('/api/v1/settings/work-week'),
  });
  const [picked, setPicked] = useState<number[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const current = picked ?? q.data?.weekendDays ?? [0, 6];
  const changed =
    picked !== null && JSON.stringify([...picked].sort()) !== JSON.stringify(q.data?.weekendDays);

  async function save() {
    setMsg(null);
    try {
      const r = await api<{ message: string }>('/api/v1/settings/work-week', {
        method: 'PUT',
        body: JSON.stringify({ weekendDays: current }),
      });
      setPicked(null);
      await qc.invalidateQueries();
      setMsg({ ok: true, text: r.message });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not save.' });
    }
  }

  return (
    <section className="card">
      <h2>Working week</h2>
      <p className="note">
        Tick the weekend days. Leave types set to skip weekends will not count these days, and
        requests still to come are recounted when this changes.
      </p>
      {q.isPending ? (
        <Skeleton />
      ) : (
        <>
          <div className="weekday-picks" role="group" aria-label="Weekend days">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <label key={d} className={`weekday-pick${current.includes(d) ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={current.includes(d)}
                  onChange={(e) =>
                    setPicked(e.target.checked ? [...current, d] : current.filter((x) => x !== d))
                  }
                />
                {DAY_NAMES[d]!.slice(0, 3)}
              </label>
            ))}
          </div>
          <p className="field-hint">
            Weekend:{' '}
            {current.length
              ? [...current]
                  .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
                  .map((d) => DAY_NAMES[d])
                  .join(', ')
              : 'none — every day is a working day'}
          </p>
          {readOnly ? null : (
            <Button
              variant="primary"
              disabled={!changed || current.length > 3}
              onClick={() => void save()}
            >
              Save working week
            </Button>
          )}
          {current.length > 3 ? (
            <p className="form-error">A weekend can be at most three days.</p>
          ) : null}
          {msg ? (
            <p role="status" className={msg.ok ? 'form-ok' : 'form-error'}>
              {msg.text}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function StaffCategoriesCard({ readOnly }: { readOnly: boolean }) {
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['org'], queryFn: () => api<Org>('/api/v1/org') });
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await api<{ name: string; code: string }>('/api/v1/staff-categories', {
        method: 'POST',
        body: JSON.stringify({ name, code: code || undefined }),
      });
      setName('');
      setCode('');
      await qc.invalidateQueries({ queryKey: ['org'] });
      setMsg({
        ok: true,
        text: `Added ${r.name} (${r.code}). Set its monthly rate in a leave type above.`,
      });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not add it.' });
    }
  }

  return (
    <section className="card">
      <h2>Staff categories</h2>
      <p className="note">
        Groups such as Production staff or Management. A leave type can credit each category at its
        own monthly rate.
      </p>
      {org.isPending ? (
        <Skeleton />
      ) : (
        <ul className="chip-list">
          {(org.data?.employmentTypes ?? []).map((t) => (
            <li key={t.id} className="chip">
              {t.name} <span className="mono">{t.code}</span>
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <form className="inline-form" onSubmit={(e) => void add(e)}>
          <input
            className="input"
            placeholder="New category, e.g. Contract staff"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Category name"
            maxLength={80}
          />
          <input
            className="input code-input"
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-label="Category code"
            maxLength={16}
          />
          <Button type="submit" disabled={name.trim().length < 2}>
            Add
          </Button>
        </form>
      )}
      {msg ? (
        <p role="status" className={msg.ok ? 'form-ok' : 'form-error'}>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}

function LeaveYearCard({ readOnly }: { readOnly: boolean }) {
  const qc = useQueryClient();
  const org = useQuery({
    queryKey: ['org'],
    queryFn: () => api<Org>('/api/v1/org'),
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
                <Select
                  name="m"
                  defaultValue={String(org.data?.company.leave_year_start_month ?? 1)}
                  fullWidth
                  disabled={readOnly}
                  options={[
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
                  ].map((label, i) => ({
                    value: String(i + 1),
                    label,
                  }))}
                />
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
        Sent to approvers when a request needs a decision, and to employees when it is approved or
        rejected. The link opens the request after signing in — it cannot approve anything on its
        own. In-app notifications work whether or not email is delivered.
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
