import { useCallback, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MinusCircle,
  Rss,
  Activity,
  Database,
} from 'lucide-react';
import type { HealthPayload } from '@/types/api';
import { API_BASE_URL } from '@/config';
import { Badge } from '@/components/Badge';
import { Callout } from '@/components/Callout';
import { StatusDot } from '@/components/StatusDot';
import { formatDate } from '@/lib/normalize';

interface StatusPageProps {
  app: HealthPayload | null;
  /** GET /health payload (same shape as app — raw display only). */
  service: HealthPayload | null;
  connection: 'online' | 'offline' | 'connecting' | 'unknown';
  error: string | null;
  lastUpdated: Date | null;
}

export function StatusPage({
  app,
  service,
  connection,
  error,
  lastUpdated,
}: StatusPageProps) {
  const overallStatus =
    connection === 'online'
      ? (app?.status ?? service?.status ?? 'ok')
      : 'offline';

  return (
    <div className="animate-fade-in space-y-4">
      <section className="surface p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-base-800 text-ukon-300">
              <Activity size={18} aria-hidden />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Overall status</h2>
              <p className="text-xs text-slate-500">
                Derived from <code className="font-mono text-slate-400">/api/v1/health</code>
              </p>
            </div>
          </div>
          <OverallStatusBadge status={overallStatus} connection={connection} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          <Field label="Status">
            <code className="font-mono text-slate-200">{overallStatus}</code>
          </Field>
          <Field label="Application">
            {app?.app ?? <Muted>Not reported</Muted>}
          </Field>
          <Field label="Version">
            {app?.version ? <code className="font-mono text-slate-200">v{app.version}</code> : <Muted>Not reported</Muted>}
          </Field>
          <Field label="Demo data">
            {app
              ? app.demo_ok
                ? `${app.demo_articles} demo articles`
                : 'Failed to load'
              : <Muted>Not reported</Muted>}
          </Field>
          <Field label="Last checked">
            {lastUpdated ? formatDate(lastUpdated.toISOString()) : <Muted>Never</Muted>}
          </Field>
          <Field label="Endpoint">
            <code className="font-mono text-slate-400 break-all">{API_BASE_URL}</code>
          </Field>
        </div>

        {app?.demo_error ? (
          <Callout variant="warning" title="Demo data problem">
            {app.demo_error}
          </Callout>
        ) : null}

        {connection === 'offline' && error ? (
          <Callout variant="error" title="Backend unreachable">
            {error}
          </Callout>
        ) : null}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <IntegrationCard
          icon={Rss}
          title="Live news feed"
          // The health flag only reports that a feed URL is configured. The
          // frontend cannot verify the feed is reachable, so it is never
          // labelled Available from this page alone.
          available={false}
          configured={app?.live_feed_configured ?? null}
          statusLabel={
            app?.live_feed_configured
              ? 'Configured (not verified reachable)'
              : 'Not configured'
          }
          tone={app?.live_feed_configured ? 'warning' : 'neutral'}
          note={
            app?.live_feed_configured
              ? 'A live feed URL is configured on the backend. Articles served in demo-fallback mode are still synthetic fixtures.'
              : 'No live feed URL is configured. In this mode articles are served from the demo fixtures.'
          }
        />
      </section>

      <section className="surface p-4 space-y-2">
        <h3 className="text-sm font-semibold text-slate-200">Labels</h3>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-400">
          <LegendItem icon={CheckCircle2} tone="success" label="Available" description="Feature is enabled and reported as available." />
          <LegendItem icon={AlertTriangle} tone="warning" label="Configured (disabled)" description="Configured on the backend but not active. 'Configured' does not mean working." />
          <LegendItem icon={MinusCircle} tone="neutral" label="Not reported" description="The health endpoint did not include this field." />
          <LegendItem icon={XCircle} tone="danger" label="Unavailable" description="The backend explicitly reported the feature as unavailable." />
        </ul>
      </section>

      {service ? (
        <section className="surface p-4 space-y-2">
          <h3 className="text-sm font-semibold text-slate-200">Raw service health</h3>
          <pre className="overflow-x-auto rounded-md bg-base-950 border border-base-800 p-3 text-xs font-mono text-slate-400">
            {JSON.stringify(service, null, 2)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

function OverallStatusBadge({
  status,
  connection,
}: {
  status: string;
  connection: 'online' | 'offline' | 'connecting' | 'unknown';
}) {
  if (connection === 'connecting') {
    return (
      <Badge tone="ukon" size="md">
        <StatusDot status="connecting" pulse />
        Connecting
      </Badge>
    );
  }
  if (connection === 'offline' || status === 'offline' || status === 'unavailable') {
    return (
      <Badge tone="danger" size="md">
        <StatusDot status="offline" />
        Unavailable
      </Badge>
    );
  }
  if (status === 'degraded') {
    return (
      <Badge tone="warning" size="md">
        <StatusDot status="degraded" />
        Degraded
      </Badge>
    );
  }
  return (
    <Badge tone="success" size="md">
      <StatusDot status="online" />
      Available
    </Badge>
  );
}

interface IntegrationCardProps {
  icon: typeof Database;
  title: string;
  available: boolean;
  configured: boolean | null;
  statusLabel: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  details?: string;
  note?: string;
}

function IntegrationCard({
  icon: Icon,
  title,
  available,
  configured,
  statusLabel,
  tone,
  details,
  note,
}: IntegrationCardProps) {
  const dotStatus: 'online' | 'offline' | 'degraded' | 'demo' | 'unknown' =
    tone === 'success'
      ? 'online'
      : tone === 'warning'
        ? 'degraded'
        : tone === 'danger'
          ? 'offline'
          : 'unknown';
  return (
    <div className="surface p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-slate-200">
          <Icon size={15} className="text-slate-400" aria-hidden />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <StatusDot status={dotStatus} label={statusLabel} />
      </div>
      {details ? <p className="text-xs text-slate-400">{details}</p> : null}
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
        <span className="rounded bg-base-800 px-2 py-0.5">
          Available: <span className="text-slate-300">{available ? 'Yes' : 'No'}</span>
        </span>
        <span className="rounded bg-base-800 px-2 py-0.5">
          Configured: <span className="text-slate-300">
            {configured === null ? 'Not reported' : configured ? 'Yes' : 'No'}
          </span>
        </span>
      </div>
      {note ? <p className="text-[11px] text-slate-500 leading-relaxed">{note}</p> : null}
    </div>
  );
}

function SentimentBar({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: string;
}) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-14 shrink-0 text-slate-400">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded bg-base-850">
        <div className={`h-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-slate-300">
        {count} ({percent}%)
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="label">{label}</p>
      <div>{children}</div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-500">{children}</span>;
}

function LegendItem({
  icon: Icon,
  tone,
  label,
  description,
}: {
  icon: typeof Database;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  label: string;
  description: string;
}) {
  const colors: Record<typeof tone, string> = {
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    neutral: 'text-slate-400',
  };
  return (
    <li className="flex items-start gap-2 rounded-md border border-base-800 bg-base-850 px-3 py-2">
      <Icon size={14} className={`mt-0.5 shrink-0 ${colors[tone]}`} aria-hidden />
      <div>
        <p className="text-slate-300 font-medium">{label}</p>
        <p className="text-slate-500">{description}</p>
      </div>
    </li>
  );
}
