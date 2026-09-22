export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|; )leaveos\.csrf=([^;]*)/);
  return m ? decodeURIComponent(m[1] ?? '') : '';
}

export function getOrCreateWorkstationId(): string {
  if (typeof window === 'undefined' || !window.localStorage) return 'ws_office_terminal';
  let id = localStorage.getItem('leaveos_workstation_id');
  if (!id) {
    id =
      'ws_' +
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem('leaveos_workstation_id', id);
  }
  return id;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-workstation-id', getOrCreateWorkstationId());
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  const method = (init.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) {
    headers.set('x-csrf-token', csrf());
  }
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'Cannot reach the Leave OS server. The office computer may be off.',
    );
  }
  const text = await res.text();
  const json = text
    ? (JSON.parse(text) as {
        data?: T;
        error?: { code: string; message: string; requestId?: string };
      })
    : {};
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json.error?.code ?? 'ERROR',
      json.error?.message ?? 'Request failed',
      json.error?.requestId,
    );
  }
  return json.data as T;
}

export type Me = {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  employeeId: string | null;
  mustChangePassword: boolean;
  companyName: string;
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekendDays: number[];
  /** Leads a team, heads a department, covers for someone, or has an HR/admin override. */
  approvesLeave: boolean;
  /** Requests currently waiting for this person's decision. */
  pendingApprovals: number;
};

export function can(me: Me | null, prefix: string): boolean {
  return Boolean(me?.permissions.some((p) => p.startsWith(prefix)));
}
