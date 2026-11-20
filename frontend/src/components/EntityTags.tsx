import type { NamedEntity } from '@/types/api';
import { entityText, entityType, entityConfidence } from '@/lib/normalize';

interface EntityTagsProps {
  entities: NamedEntity[];
}

const ENTITY_TONES: Record<string, string> = {
  PER: 'bg-ukon-900/40 text-ukon-200 border-ukon-700/60',
  PERSON: 'bg-ukon-900/40 text-ukon-200 border-ukon-700/60',
  ORG: 'bg-success/15 text-success border-success/40',
  ORGANIZATION: 'bg-success/15 text-success border-success/40',
  LOC: 'bg-ukyellow-500/15 text-ukyellow-200 border-ukyellow-500/40',
  LOCATION: 'bg-ukyellow-500/15 text-ukyellow-200 border-ukyellow-500/40',
  GPE: 'bg-ukyellow-500/15 text-ukyellow-200 border-ukyellow-500/40',
  MISC: 'bg-base-800 text-slate-300 border-base-700',
};

function toneFor(type: string): string {
  const normalized = type.toUpperCase();
  for (const key of Object.keys(ENTITY_TONES)) {
    if (normalized.includes(key.toUpperCase())) return ENTITY_TONES[key];
  }
  return ENTITY_TONES.MISC;
}

export function EntityTags({ entities }: EntityTagsProps) {
  if (entities.length === 0) {
    return <p className="text-sm text-slate-500">No named entities detected.</p>;
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {entities.map((entity, idx) => {
        const text = entityText(entity);
        const type = entityType(entity);
        const confidence = entityConfidence(entity);
        return (
          <li
            key={`${text}-${idx}`}
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${toneFor(type)}`}
            title={typeof confidence === 'number' ? `Confidence ${(confidence * 100).toFixed(1)}%` : undefined}
          >
            <span className="text-sm font-medium text-slate-100">{text}</span>
            <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wider opacity-80">
              {type}
            </span>
            {typeof confidence === 'number' ? (
              <span className="font-mono text-[10px] opacity-70">
                {(confidence * 100).toFixed(0)}%
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
