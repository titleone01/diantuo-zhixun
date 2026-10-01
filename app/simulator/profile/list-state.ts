export type ProfileListTab = 'drafts' | 'publications' | 'favorites';
export type ProfileRoute = { tab: ProfileListTab | 'admin'; query: string; page: number };
export type ProfilePage<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };
export const PROFILE_PAGE_SIZE = 12;
export const PROFILE_DRAFT_PAGE_SIZES = [10, 20, 25, 30, 40, 50] as const;

export type ProfileListScope = {
  ownerId: string;
  /** WorkspaceBoundary's session, not only the member ID: A→B→A is a new session. */
  session: number;
  tab: ProfileListTab;
  query: string;
  page: number;
  pageSize?: number;
};

const pageNumber = (page: number) => Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1;
const searchTerm = (query: string) => query.trim().slice(0, 100);
const batchSize = (tab: ProfileListTab, value?: number) => tab === 'drafts'
  ? PROFILE_DRAFT_PAGE_SIZES.find(size => size === value) ?? 10
  : value !== undefined && Number.isInteger(value) && value >= 1 && value <= 24 ? value : PROFILE_PAGE_SIZE;

export const emptyProfileRoute = (): ProfileRoute => ({ tab: 'publications', query: '', page: 1 });
export function readProfileRoute(search: string): ProfileRoute {
  const params = new URLSearchParams(search);
  const requested = params.get('tab');
  const tab = requested === 'drafts' || requested === 'favorites' || requested === 'admin' ? requested : 'publications';
  const rawPage = params.get('page') || '1';
  return { tab, query: (params.get('q') || '').slice(0, 100), page: tab === 'drafts' && /^[1-9]\d*$/.test(rawPage) ? pageNumber(Number(rawPage)) : 1 };
}
export function profileHref(route: ProfileRoute): string {
  const params = new URLSearchParams();
  if (route.tab !== 'publications') params.set('tab', route.tab);
  if (searchTerm(route.query)) params.set('q', searchTerm(route.query));
  if (route.tab === 'drafts' && pageNumber(route.page) > 1) params.set('page', String(pageNumber(route.page)));
  return `/profile${params.size ? `?${params}` : ''}`;
}

/** One bounded response already contains the circuits needed for card previews. */
export function profileListPath(tab: ProfileListTab, query: string, page: number, pageSize?: number): string {
  const params = new URLSearchParams({ page: String(pageNumber(page)), pageSize: String(batchSize(tab, pageSize)) });
  if (tab !== 'drafts') { params.set('filter', tab === 'favorites' ? 'favorites' : 'mine'); params.set('includeDocument', '1'); }
  const keyword = searchTerm(query);
  if (keyword) params.set('q', keyword);
  return `${tab === 'drafts' ? '/circuits' : '/publications'}?${params}`;
}

const scopeKey = ({ ownerId, session, tab, query, page, pageSize }: ProfileListScope) => JSON.stringify([ownerId, session, tab, searchTerm(query), pageNumber(page), batchSize(tab, pageSize)]);
export type ProfileListTicket = Readonly<{ revision: number; scope: string }>;

/** No list cache: guard success, error and finally against the currently shown scope.
 * Invalidate immediately on navigation/logout/unmount, before the next effect runs.
 * Reaction GET/POST merging stays in the existing GalleryRequestState.
 */
export class ProfileListRequests {
  private revision = 0;
  begin(scope: ProfileListScope): ProfileListTicket { return { revision: ++this.revision, scope: scopeKey(scope) }; }
  invalidate() { this.revision++; }
  accepts(ticket: ProfileListTicket, currentScope: ProfileListScope | null): boolean {
    return currentScope !== null && ticket.revision === this.revision && ticket.scope === scopeKey(currentScope);
  }
}
