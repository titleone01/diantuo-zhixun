import type { AppEnv, Member } from './auth';
import { ApiError } from './http';
import { publicationColumns, publicView, type PublicationRow } from './content';

function positiveInteger(value: string | null, fallback: number, maximum: number, label: string): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) throw new ApiError(400, 'INVALID_PAGINATION', `${label}超出允许范围`);
  return Number(value);
}

export function publicationListOptions(search: URLSearchParams) {
  const query = (search.get('q') || '').trim();
  if (query.length > 100) throw new ApiError(400, 'INVALID_QUERY', '搜索内容不能超过 100 个字符');
  const filter = search.get('filter') || (search.has('mine') ? 'mine' : search.has('favorite') ? 'favorites' : '');
  if (!['', 'mine', 'favorites', 'liked'].includes(filter)) throw new ApiError(400, 'INVALID_FILTER', '作品筛选条件无效');
  const includeDocument = search.get('includeDocument') === '1';
  const page = positiveInteger(search.get('page'), 1, 100000, '页码');
  // Existing metadata-only consumers retain their previous maximum. A gallery
  // page carries the saved circuit for its previews, so its payload is bounded.
  const pageSize = positiveInteger(search.get('pageSize'), includeDocument ? 12 : 100, includeDocument ? 24 : 100, '每页数量');
  return { query, filter, page, pageSize, includeDocument };
}

export async function listPublications(env: Pick<AppEnv, 'DB'>, member: Pick<Member, 'id'>, search: URLSearchParams) {
  const options = publicationListOptions(search);
  const parameters: (string | number)[] = [];
  let condition = '1=1';
  if (options.query) {
    const literal = `%${options.query.replace(/[\\%_]/g, '\\$&')}%`;
    condition += " AND (p.title LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')";
    parameters.push(literal, literal, literal, literal);
  }
  if (options.filter === 'mine') { condition += ' AND p.ownerId=?'; parameters.push(member.id); }
  if (options.filter === 'favorites' || options.filter === 'liked') {
    condition += ' AND EXISTS(SELECT 1 FROM reactions f WHERE f.publicationId=p.id AND f.userId=? AND f.kind=?)';
    parameters.push(member.id, options.filter === 'liked' ? 'like' : 'favorite');
  }
  const from = `FROM publications p JOIN user u ON p.ownerId=u.id WHERE ${condition}`;
  const count = await env.DB.prepare(`SELECT COUNT(*) total ${from}`).bind(...parameters).first<{ total: number }>();
  const total = count?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / options.pageSize));
  const page = Math.min(options.page, totalPages);
  const rows = await env.DB.prepare(`SELECT ${publicationColumns}${options.includeDocument ? ',p.document' : ''} ${from} ORDER BY p.createdAt DESC,p.id DESC LIMIT ? OFFSET ?`)
    .bind(member.id, member.id, ...parameters, options.pageSize, (page - 1) * options.pageSize).all<PublicationRow>();
  return { items: rows.results.map(publicView), page, pageSize: options.pageSize, total, totalPages, query: options.query };
}
