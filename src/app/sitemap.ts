import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';

/**
 * Generated at build time, so it can never go stale the way the old
 * hand-written public/sitemap.xml did (its lastmod was frozen in the past and
 * it was missing /events entirely).
 *
 * Only public pages belong here — /admin, /api and /checkout are excluded, as
 * they are in robots.txt.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const routes: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }> = [
    { path: '', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/sweets', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/pickles', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/gift-boxes', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/events', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/about', priority: 0.7, changeFrequency: 'monthly' },
  ];

  return routes.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
