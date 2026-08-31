import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@sns/ui';
import { api, ApiError } from '../api.js';

export function SetupPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showAdminPass, setShowAdminPass] = useState(true);
  const [form, setForm] = useState({
    companyName: 'Simon & Sons',
    timezone: 'Asia/Kolkata',
    leaveYearStartMonth: 1,
    leaveYearStartDay: 1,
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    loadSampleData: true,
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api('/api/v1/setup', { method: 'POST', body: JSON.stringify(form) });
      await api('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.adminEmail, password: form.adminPassword }),
      });
      await qc.invalidateQueries();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-pane" style={{ minHeight: '100vh', maxWidth: 560, margin: '0 auto' }}>
      <div className="brand">
        <div className="mark">S</div>
        <span className="brand-name">Simon &amp; Sons</span>
        <span className="brand-chip">Leave OS</span>
      </div>
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="page-stack"
        style={{ maxWidth: 480, margin: '32px 0' }}
      >
        <div>
          <h1 style={{ fontSize: 32, letterSpacing: '-0.03em', margin: '0 0 8px' }}>First run</h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            This creates the first administrator on this machine, along with a starter set of leave
            types and rules you can edit in Settings.
          </p>
        </div>
        {error ? (
          <p role="alert" style={{ color: 'var(--status-rejected-fg)' }}>
            {error}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor="s-co">Company name</label>
          <input
            id="s-co"
            className="input"
            required
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="s-tz">Time zone</label>
          <input
            id="s-tz"
            className="input"
            required
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          />
        </div>
        <div className="two">
          <div className="field">
            <label htmlFor="s-m">Leave year month</label>
            <input
              id="s-m"
              className="input"
              type="number"
              min={1}
              max={12}
              value={form.leaveYearStartMonth}
              onChange={(e) => setForm({ ...form, leaveYearStartMonth: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="s-d">Leave year day</label>
            <input
              id="s-d"
              className="input"
              type="number"
              min={1}
              max={31}
              value={form.leaveYearStartDay}
              onChange={(e) => setForm({ ...form, leaveYearStartDay: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="s-name">Administrator name</label>
          <input
            id="s-name"
            className="input"
            required
            value={form.adminName}
            onChange={(e) => setForm({ ...form, adminName: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="s-email">Administrator email</label>
          <input
            id="s-email"
            className="input"
            type="email"
            required
            value={form.adminEmail}
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
          />
        </div>
        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label htmlFor="s-pass" style={{ margin: 0 }}>
              Password (12+ characters)
            </label>
            <button
              type="button"
              onClick={() => setShowAdminPass(!showAdminPass)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 12,
                color: 'var(--brand-primary, #0284c7)',
                cursor: 'pointer',
              }}
            >
              {showAdminPass ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            id="s-pass"
            className="input"
            type={showAdminPass ? 'text' : 'password'}
            required
            minLength={12}
            value={form.adminPassword}
            onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
          />
        </div>
        <label className="inline-opt">
          <input
            type="checkbox"
            checked={form.loadSampleData}
            onChange={(e) => setForm({ ...form, loadSampleData: e.target.checked })}
          />
          Load synthetic sample people (@example.invalid)
        </label>
        <Button variant="primary" type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create administrator'}
        </Button>
      </form>
    </main>
  );
}
