export type GalleryRoute = { query: string; page: number; publicationId?: string };
export const emptyGalleryRoute = (): GalleryRoute => ({ query: '', page: 1 });
export const APP_LOCATION_CHANGED = 'diantuo:locationchange';

/** pushState/replaceState do not emit popstate; every app navigation notifies readers. */
export function navigateAppLocation(href: string, options: { replace?: boolean; state?: unknown } = {}) {
  if (options.replace) history.replaceState(options.state ?? {}, '', href);
  else history.pushState(options.state ?? {}, '', href);
  dispatchEvent(new Event(APP_LOCATION_CHANGED));
}

export function galleryRouteFromSearch(search: string): GalleryRoute {
  const params = new URLSearchParams(search);
  const page = params.get('page') || '1';
  const publicationId = params.get('publication') || undefined;
  return {
    query: (params.get('q') || '').slice(0, 100),
    page: /^[1-9]\d*$/.test(page) && Number(page) <= 100000 ? Number(page) : 1,
    publicationId: publicationId?.slice(0, 80),
  };
}

export function galleryHref(route: GalleryRoute): string {
  const params = new URLSearchParams();
  if (route.query) params.set('q', route.query);
  if (route.page > 1) params.set('page', String(route.page));
  if (route.publicationId) params.set('publication', route.publicationId);
  return `/gallery${params.size ? `?${params}` : ''}`;
}

export function galleryListPath(route: GalleryRoute): string {
  const params = new URLSearchParams({ page: String(route.page), pageSize: '12', includeDocument: '1' });
  if (route.query) params.set('q', route.query);
  return `/publications?${params}`;
}
