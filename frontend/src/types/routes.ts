export type Route = 'overview' | 'news' | 'status';

export interface RouteMeta {
  id: Route;
  label: string;
  description: string;
}

export const ROUTES: Record<Route, RouteMeta> = {
  overview: {
    id: 'overview',
    label: 'Overview',
    description: 'Platform state, backend health, and recent intelligence.',
  },
  news: {
    id: 'news',
    label: 'News Intelligence',
    description: 'Browse Ukrainian news articles and run sentiment and entity analysis.',
  },
  status: {
    id: 'status',
    label: 'System Status',
    description: 'Backend health, demo data, and integration availability.',
  },
};
