import { useCallback, useRef, useState } from 'react';

export type RequestStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  status: RequestStatus;
  data: T | null;
  error: Error | null;
}

export interface UseAsyncRequestResult<T> extends AsyncState<T> {
  run: (fn: (signal: AbortSignal) => Promise<T>) => Promise<T | null>;
  reset: () => void;
  cancel: () => void;
  isPending: boolean;
}

/**
 * Manages a single in-flight async request with cancellation and prevents
 * duplicate submissions while a request is running.
 */
export function useAsyncRequest<T>(): UseAsyncRequestResult<T> {
  const [state, setState] = useState<AsyncState<T>>({
    status: 'idle',
    data: null,
    error: null,
  });
  const controllerRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    runningRef.current = false;
  }, []);

  const reset = useCallback(() => {
    cancel();
    setState({ status: 'idle', data: null, error: null });
  }, [cancel]);

  const run = useCallback(async (fn: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    if (runningRef.current) return null;
    cancel();
    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setState({ status: 'loading', data: null, error: null });

    try {
      const data = await fn(controller.signal);
      if (!controller.signal.aborted) {
        setState({ status: 'success', data, error: null });
        return data;
      }
      return null;
    } catch (err) {
      if (controller.signal.aborted) {
        setState((prev) => ({
          status: prev.status === 'loading' ? 'idle' : prev.status,
          data: prev.data,
          error: prev.error,
        }));
        return null;
      }
      const error = err instanceof Error ? err : new Error('Unexpected error');
      setState({ status: 'error', data: null, error });
      return null;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      runningRef.current = false;
    }
  }, [cancel]);

  return {
    ...state,
    run,
    reset,
    cancel,
    isPending: state.status === 'loading',
  };
}
