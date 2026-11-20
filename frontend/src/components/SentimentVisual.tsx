import type { AnalysisResponse } from '@/types/api';
import {
  sentimentStatus,
  sentimentLabel,
  sentimentCaveat,
  sentimentErrorReason,
} from '@/lib/normalize';
import { Badge } from '@/components/Badge';

interface SentimentVisualProps {
  analysis: AnalysisResponse;
}

/**
 * Renders the sentiment section exactly as the backend contracts it: a label,
 * the model's own caveat, and the evaluation status.
 * This contract has no score distribution, so none is shown or fabricated.
 * No calibrated-confidence claims are made.
 */
export function SentimentVisual({ analysis }: SentimentVisualProps) {
  const status = sentimentStatus(analysis);
  const label = sentimentLabel(analysis);
  const caveat = sentimentCaveat(analysis);
  const errorReason = sentimentErrorReason(analysis);

  if (status !== 'ok' && !label) {
    return (
      <div className="space-y-2">
        <p className="label">Predicted sentiment</p>
        <p className="text-sm text-slate-500">
          The sentiment section did not complete{errorReason ? ` (${errorReason})` : ''}. No
          prediction is shown.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="label">Predicted sentiment</p>
          <p className={`mt-1 font-serif text-2xl font-semibold`}>
            {label ?? 'Unknown'}
          </p>
        </div>
        {status !== 'ok' ? (
          <Badge tone="warning" size="sm">
            {status}
          </Badge>
        ) : null}
      </div>

      {caveat ? (
        <p className="text-[11px] leading-relaxed text-slate-500">
          <span className="font-medium text-slate-400">Model note:</span> {caveat}
        </p>
      ) : null}
      {errorReason ? (
        <p className="text-[11px] text-warning">
          Section status: {status}{errorReason ? ` — ${errorReason}` : ''}
        </p>
      ) : null}
      {analysis.sentiment.evaluation_status ? (
        <p className="text-[11px] text-slate-500">
          Evaluation status: {analysis.sentiment.evaluation_status} — a technical success is not
          validation of predictive quality.
        </p>
      ) : null}
      {analysis.sentiment.model_id ? (
        <p className="text-[11px] text-slate-500">
          Model: <code className="font-mono">{analysis.sentiment.model_id}</code>
        </p>
      ) : null}
    </div>
  );
}