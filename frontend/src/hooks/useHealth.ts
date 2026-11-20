import { useCallback, useEffect, useRef, useState } from 'react';
import type { HealthPayload } from '@/types/api';
import { getHealth, getAppHealth, ApiError } from '@/services/api';

export type BackendConnectionState = 'unknown' | 'connecting' | 'online' | 'offline';

export interface HealthState {
  connection: BackendConnectionState;
  /** GET /health payload (same fields as the /api/v1 one). */
  service: HealthPayload | null;
  /** GET /api/v1/health payload. */
  app: HealthPayload | null;
  error: string | null;
  lastUpdated: Date | null;
}

export interface UseHealthResult extends HealthState {
  refresh: () => void;
  /** Stable controller for cancelling in-flight requests. */
  abort: () => void;
}

/**
 * Polls both /health and /api/v1/health. Treats the backend as online only
 * when a health endpoint actually responds. Never fabricates status.
 */
export function useHealth(pollIntervalMs = 30_000): UseHealthResult {
  const [state, setState] = useState<HealthState>({
    connection: 'connecting',
    service: null,
    app: null,
    error: null,
    lastUpdated: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const refresh = useCallback(() => {
    abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, connection: 'connecting' }));

    Promise.allSettled([getHealth(controller.signal), getAppHealth(controller.signal)])
      .then(([serviceResult, appResult]) => {
        if (!mountedRef.current) return;
        const service =
          serviceResult.status === 'fulfilled' ? serviceResult.value : null;
        const app = appResult.status === 'fulfilled' ? appResult.value : null;

        if (serviceResult.status === 'rejected' && appResult.status === 'rejected') {
          const err =
            serviceResult.reason instanceof ApiError
              ? serviceResult.reason
              : appResult.reason instanceof ApiError
                ? appResult.reason
                : null;
          setState({
            connection: 'offline',
            service: null,
            app: null,
            error: err?.message ?? 'Backend is not reachable.',
            lastUpdated: new Date(),
          });
          return;
        }

        setState({
          connection: 'online',
          service,
          app,
          error: null,
          lastUpdated: new Date(),
        });
      })
      .finally(() => {
        if (mountedRef.current && abortRef.current === controller) {
          abortRef.current = null;
        }
      });
  }, [abort]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const interval = window.setInterval(refresh, pollIntervalMs);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      abort();
    };
  }, [refresh, pollIntervalMs, abort]);

  return { ...state, refresh, abort };
}
