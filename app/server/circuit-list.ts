import type { AppEnv, Member } from './auth';
import type { CircuitRow } from './content';
import { ApiError } from './http';

export type CircuitListItem = Pick<CircuitRow, 'id' | 'title' | 'revision' | 'forkedFrom' | 'createdAt' | 'updatedAt'>;

function positiveInteger(value: string | null, fallback: number, maximum: number, label: string): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) throw new ApiError(400, 'INVALID_PAGINATION', `${label}超出允许范围`);
  return Number(value);
}

export function circuitListOptions(search: URLSearchParams) {
  const query = (search.get('q') || '').trim();
  if (query.length > 100) throw new ApiError(400, 'INVALID_QUERY', '搜索内容不能超过 100 个字符');
  const page = positiveInteger(search.get('page'), 1, 100000, '页码');
  // Older consumers expect the former 200-item list. New UIs request smaller pages.
  const pageSize = positiveInteger(search.get('pageSize'), 200, 200, '每页数量');
  return { query, page, pageSize };
}

/** Metadata-only private drafts. The owner comes exclusively from server authentication. */
export async function listCircuits(env: Pick<AppEnv, 'DB'>, member: Pick<Member, 'id'>, search: URLSearchParams) {
  const options = circuitListOptions(search);
  const parameters: (string | number)[] = [member.id];
  let condition = 'ownerId=?';
  if (options.query) {
    condition += " AND title LIKE ? ESCAPE '\\'";
    parameters.push(`%${options.query.replace(/[\\%_]/g, '\\$&')}%`);
  }
  const count = await env.DB.prepare(`SELECT COUNT(*) total FROM circuits WHERE ${condition}`).bind(...parameters).first<{ total: number }>();
  const total = count?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / options.pageSize));
  const page = Math.min(options.page, totalPages);
  const rows = await env.DB.prepare(`SELECT id,title,revision,forkedFrom,createdAt,updatedAt FROM circuits WHERE ${condition} ORDER BY updatedAt DESC,id DESC LIMIT ? OFFSET ?`)
    .bind(...parameters, options.pageSize, (page - 1) * options.pageSize).all<CircuitListItem>();
  return { items: rows.results, page, pageSize: options.pageSize, total, totalPages, query: options.query };
}
