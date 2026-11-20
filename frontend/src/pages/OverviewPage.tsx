import { useEffect, useState } from 'react';
import { Newspaper, ArrowRight, Activity, Database, FlaskConical } from 'lucide-react';
import type { Route } from '@/types/routes';
import type { ArticlesResponse, Article, HealthPayload } from '@/types/api';
import { listArticles, ApiError } from '@/services/api';
import { isDemoFallback } from '@/lib/normalize';
import { Callout } from '@/components/Callout';
import { Badge } from '@/components/Badge';
import { Spinner } from '@/components/Spinner';
import { StatusDot } from '@/components/StatusDot';
import { EmptyState } from '@/components/EmptyState';
import { ArticleCard } from '@/components/ArticleCard';

interface OverviewPageProps {
  health: HealthPayload | null;
  connection: 'online' | 'offline' | 'connecting' | 'unknown';
  healthError: string | null;
  onNavigate: (route: Route) => void;
}

export function OverviewPage({
  health,
  connection,
  healthError,
  onNavigate,
}: OverviewPageProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listArticles({ limit: 5 }, controller.signal)
      .then((res: ArticlesResponse) => {
        setArticles(res.articles ?? []);
        setDemoMode(isDemoFallback(res));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof ApiError
            ? err.aborted
              ? 'Articles request timed out. The backend may be slow to respond.'
              : err.message
            : 'Could not load recent articles.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [connection]);

  const articleCount =
    health && health.demo_ok ? health.demo_articles : articles.length;
  const llmEnabled = health?.lm_studio_enabled ?? false;
  const demoAvailable = health?.demo_ok ?? false;

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative h-7 w-7 overflow-hidden rounded-md border border-base-700">
            <div className="absolute inset-0 flex flex-col">
              <div className="flex-1 bg-ukon-500" />
              <div className="flex-1 bg-ukyellow-400" />
            </div>
          </div>
          <span className="label">Intelligence workspace</span>
        </div>
        <h2 className="font-serif text-3xl font-semibold text-white tracking-tight text-balance">
          Ukrainian News Intelligence
        </h2>
        <p className="max-w-2xl text-sm text-slate-400 leading-relaxed">
          A local-first analysis workspace for Ukrainian news. Browse articles,
          run sentiment and named-entity analysis on local models, and inspect
          facial expressions in uploaded images. Some data is synthetic and
          some models are experimental — both are clearly indicated.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          icon={Activity}
          title="Backend status"
          status={
            connection === 'online'
              ? 'online'
              : connection === 'connecting'
                ? 'connecting'
                : 'offline'
          }
          statusLabel={
            connection === 'online'
              ? 'Online'
              : connection === 'connecting'
                ? 'Connecting'
                : 'Offline'
          }
        >
          {connection === 'offline' && healthError ? (
            <p className="text-xs text-slate-400">{healthError}</p>
          ) : health ? (
            <div className="space-y-1 text-xs text-slate-400">
              {health.app ? <p>{health.app}</p> : null}
              {health.version ? <p className="font-mono">v{health.version}</p> : null}
            </div>
          ) : (
            <p className="text-xs text-slate-500">Awaiting health response…</p>
          )}
        </SummaryCard>

        <SummaryCard
          icon={Newspaper}
          title="News feed mode"
          status={demoMode ? 'demo' : 'online'}
          statusLabel={
            connection === 'offline'
              ? 'Unknown'
              : demoMode
                ? 'Demo fallback'
                : 'Live mode'
          }
        >
          <p className="text-xs text-slate-400">
            {connection === 'offline'
              ? 'Backend offline — feed mode unknown.'
              : demoMode
                ? 'Articles are synthetic fixtures, not live reporting.'
                : 'The backend served the articles as live-mode records.'}
          </p>
        </SummaryCard>

        <SummaryCard
          icon={Database}
          title="Articles available"
          status="ukon"
          statusLabel={connection === 'offline' ? 'Unknown' : `${articleCount} articles`}
        >
          <p className="text-xs text-slate-400">
            {connection === 'offline'
              ? 'Connect the backend to load the article count.'
              : demoAvailable
                ? 'Reported directly by the backend (demo fixture count).'
                : 'Returned directly from the articles endpoint.'}
          </p>
        </SummaryCard>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ActionCard
          icon={Newspaper}
          title="News Intelligence"
          description="Browse the article feed, open details, and run sentiment and named-entity analysis."
          actionLabel="Open News Intelligence"
          onClick={() => onNavigate('news')}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-200">Recent articles</h3>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => onNavigate('news')}
          >
            View all
            <ArrowRight size={14} aria-hidden />
          </button>
        </div>

        <div className="surface p-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
              <Spinner size={16} className="text-ukon-300" />
              Loading recent articles…
            </div>
          ) : error ? (
            <Callout variant="error" title="Could not load articles">
              {error}
            </Callout>
          ) : articles.length === 0 ? (
            <EmptyState
              title="No articles returned"
              description="The backend responded but did not provide any articles. Check the system status page."
            />
          ) : (
            <div className="space-y-1">
              {articles.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  onClick={() => onNavigate('news')}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="surface p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FlaskConical size={16} className="text-ukon-300" aria-hidden />
          <h3 className="text-sm font-semibold text-slate-200">Capabilities &amp; limitations</h3>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-400">
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ukon-400" aria-hidden />
            <span>Sentiment and named-entity models run locally and may take over a minute on first use.</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ukon-400" aria-hidden />
            <span>These NLP models are experimental and have limited validation on Ukrainian text; the sentiment model is a Russian-language (<code className="font-mono">-ru</code>) model, so Ukrainian quality is unvalidated.</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ukon-400" aria-hidden />
            <span>
              LLM summarisation is currently disabled
              {llmEnabled ? ' (enabled on backend but not validated)' : ''}.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ukon-400" aria-hidden />
            <span>
              {demoAvailable
                ? 'Demo fixtures are currently available on the backend.'
                : 'Demo fixtures are not currently available.'}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ukon-400" aria-hidden />
            <span>Image analysis is omitted from the online edition; only sentiment and NER are supported.</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ukon-400" aria-hidden />
            <span>No article data is sent to external services.</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

interface SummaryCardProps {
  icon: typeof Activity;
  title: string;
  status: 'online' | 'offline' | 'connecting' | 'demo' | 'ukon';
  statusLabel: string;
  children: React.ReactNode;
}

function SummaryCard({ icon: Icon, title, status, statusLabel, children }: SummaryCardProps) {
  const dotStatus =
    status === 'online'
      ? 'online'
      : status === 'offline'
        ? 'offline'
        : status === 'connecting'
          ? 'connecting'
          : status === 'demo'
            ? 'demo'
            : 'unknown';
  return (
    <div className="surface p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-slate-300">
          <Icon size={15} className="text-slate-400" aria-hidden />
          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
            {title}
          </span>
        </div>
        <StatusDot status={dotStatus} pulse={status === 'connecting'} label={statusLabel} />
      </div>
      <div className="pt-1">{children}</div>
    </div>
  );
}

interface ActionCardProps {
  icon: typeof Activity;
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
}

function ActionCard({ icon: Icon, title, description, actionLabel, onClick }: ActionCardProps) {
  return (
    <div className="surface p-4 flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-base-800 text-ukon-300">
        <Icon size={18} aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <Badge tone="ukon" size="sm">
            Available
          </Badge>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
        <button type="button" className="btn-primary text-xs" onClick={onClick}>
          {actionLabel}
          <ArrowRight size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
