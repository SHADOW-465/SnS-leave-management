import { Button } from './Button.js';

export function ErrorState({
  title,
  body,
  requestId,
  onRetry,
}: {
  title: string;
  body: string;
  requestId?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="card" role="alert">
      <p style={{ margin: 0, fontWeight: 600 }}>{title}</p>
      <p className="note">{body}</p>
      {requestId ? <p className="note mono">Quote this request id: {requestId}</p> : null}
      {onRetry ? (
        <div style={{ marginTop: 12 }}>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      ) : null}
    </div>
  );
}
