import { Newspaper, ExternalLink, Calendar, Globe, EyeOff } from 'lucide-react';
import type { Article } from '@/types/api';
import {
  articleTitle,
  articleSource,
  articleAnalysisStatus,
  articlePublishedAt,
  articleExcerpt,
  articleUrl,
  articleIsDemo,
  formatDateShort,
} from '@/lib/normalize';
import { Badge } from '@/components/Badge';

interface ArticleCardProps {
  article: Article;
  active?: boolean;
  onClick?: () => void;
}

export function ArticleCard({ article, active = false, onClick }: ArticleCardProps) {
  const demo = articleIsDemo(article);
  const headline = articleTitle(article);
  const source = articleSource(article);
  const published = articlePublishedAt(article);
  const url = articleUrl(article);
  const excerpt = articleExcerpt(article);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full text-left rounded-md border p-4 transition-colors ${
        active
          ? 'border-ukon-600 bg-base-850'
          : 'border-base-800 bg-base-900 hover:border-base-700 hover:bg-base-850'
      }`}
      aria-pressed={active}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-slate-600">
          <Newspaper size={18} aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-serif text-[15px] font-medium leading-snug text-slate-100 text-balance group-hover:text-white">
              {headline}
            </h3>
            <div className="flex shrink-0 gap-1.5">
              {articleAnalysisStatus(article) === 'metadata_only' ? (
                <span
                  title="Metadata only — headline and source reference are stored, and the content is not passed to Ukrainian text analysis (Kyiv Independent policy)."
                >
                  <Badge tone="neutral" size="sm">
                    <EyeOff size={11} aria-hidden />
                    Metadata only
                  </Badge>
                </span>
              ) : null}
              {demo ? (
                <Badge tone="demo" size="sm">
                  DEMO
                </Badge>
              ) : null}
            </div>
          </div>

          {excerpt ? (
            <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{excerpt}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {source ? (
              <span className="inline-flex items-center gap-1 text-slate-400">
                <Newspaper size={11} aria-hidden />
                {source}
              </span>
            ) : null}
            {published ? (
              <span className="inline-flex items-center gap-1">
                <Calendar size={11} aria-hidden />
                {formatDateShort(published) ?? published}
              </span>
            ) : null}
            {article.language ? (
              <span className="inline-flex items-center gap-1 uppercase">
                <Globe size={11} aria-hidden />
                {article.language}
              </span>
            ) : null}
            {url ? (
              <span className="inline-flex items-center gap-1 text-ukon-300">
                <ExternalLink size={11} aria-hidden />
                Source link
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
