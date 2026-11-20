import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const art = vi.hoisted(() => (i: number) => ({
  id: `a${i}`, title: `Стаття ${i}`, source: 'Test', source_id: 'test',
  published_at: '2026-11-20T10:00:00Z', url: 'https://x.test/' + i,
  excerpt: 'Текст', language: 'uk', analysis_status: 'eligible',
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<any>('@/services/api');
  const health = { status: 'ok', app: 'x', version: '1' };
  return {
    ...actual,
    getHealth: vi.fn().mockResolvedValue(health),
    getAppHealth: vi.fn().mockResolvedValue(health),
    getAppMode: vi.fn().mockResolvedValue({ mode: 'live' }),
    setAppMode: vi.fn().mockResolvedValue({ mode: 'live' }),
    listArticles: vi.fn().mockResolvedValue({ articles: [art(1), art(2)], count: 2, mode: 'live' }),
    getArticle: vi.fn().mockResolvedValue(art(1)),
    analyzeArticle: vi.fn().mockResolvedValue({}),
  };
});

import App from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';

describe('smoke', () => {
  it('navigates every page and opens an article without crashing', async () => {
    render(<ErrorBoundary><App /></ErrorBoundary>);
    for (const label of ['News Intelligence', 'Status', 'Overview', 'News Intelligence']) {
      fireEvent.click(screen.getAllByRole('button', { name: new RegExp(label, 'i') })[0]);
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByText('Something went wrong')).toBeNull();
    }
    await waitFor(() => expect(screen.getAllByText(/Стаття 1/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(/Стаття 1/)[0]);
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.getByText(/Back to articles/)).toBeTruthy();
  });
});
