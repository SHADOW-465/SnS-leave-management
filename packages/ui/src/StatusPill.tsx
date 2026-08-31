import { Ban, Check, CircleMinus, Clock } from 'lucide-react';

const MAP: Record<string, { bg: string; fg: string; label: string; Icon: typeof Check }> = {
  pending_approval: {
    bg: 'var(--status-pending-bg)',
    fg: 'var(--status-pending-fg)',
    label: 'Pending',
    Icon: Clock,
  },
  submitted: {
    bg: 'var(--status-pending-bg)',
    fg: 'var(--status-pending-fg)',
    label: 'Submitted',
    Icon: Clock,
  },
  approved: {
    bg: 'var(--status-approved-bg)',
    fg: 'var(--status-approved-fg)',
    label: 'Approved',
    Icon: Check,
  },
  rejected: {
    bg: 'var(--status-rejected-bg)',
    fg: 'var(--status-rejected-fg)',
    label: 'Rejected',
    Icon: Ban,
  },
  withdrawn: {
    bg: 'var(--status-neutral-bg)',
    fg: 'var(--status-neutral-fg)',
    label: 'Withdrawn',
    Icon: CircleMinus,
  },
  cancelled: {
    bg: 'var(--status-neutral-bg)',
    fg: 'var(--status-neutral-fg)',
    label: 'Cancelled',
    Icon: CircleMinus,
  },
  cancellation_requested: {
    bg: 'var(--status-pending-bg)',
    fg: 'var(--status-pending-fg)',
    label: 'Cancel requested',
    Icon: Clock,
  },
  active: {
    bg: 'var(--status-approved-bg)',
    fg: 'var(--status-approved-fg)',
    label: 'Active',
    Icon: Check,
  },
  probation: {
    bg: 'var(--status-pending-bg)',
    fg: 'var(--status-pending-fg)',
    label: 'Probation',
    Icon: Clock,
  },
  exited: {
    bg: 'var(--status-neutral-bg)',
    fg: 'var(--status-neutral-fg)',
    label: 'Exited',
    Icon: CircleMinus,
  },
};

export function StatusPill({ status }: { status: string }) {
  const m = MAP[status] ?? {
    bg: 'var(--status-neutral-bg)',
    fg: 'var(--status-neutral-fg)',
    label: status,
    Icon: CircleMinus,
  };
  const Icon = m.Icon;
  return (
    <span className="pill" style={{ background: m.bg, color: m.fg }}>
      <Icon size={12} strokeWidth={2.25} aria-hidden />
      {m.label}
    </span>
  );
}
