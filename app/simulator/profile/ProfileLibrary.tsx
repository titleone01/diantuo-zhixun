'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, CircuitBoard, FolderOpen, Heart, Search, Star } from 'lucide-react';
import { STATIC_DEMO, type Publication, type SavedCircuit } from '../api';
import DocumentPreview from '../editor/DocumentPreview';
import { PROFILE_DRAFT_PAGE_SIZES, ProfileListRequests, profileListPath, type ProfileListScope, type ProfileListTab, type ProfilePage } from './list-state';
import './profile-library.css';

type Item = SavedCircuit | Publication;
type Props = {
  ownerId: string;
  tab: ProfileListTab;
  refresh: number;
  busy: boolean;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  onOpenDraft: (item: SavedCircuit) => void;
  onDeleteDraft: (item: SavedCircuit) => void;
  onOpenPublication: (id: string) => void;
  onNew: () => void;
};

const LOCAL_KEY = 'diantuo:simulator:demo:v1';
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const blankPage = (pageSize: number): ProfilePage<Item> => ({ items: [], page: 1, pageSize, total: 0, totalPages: 1 });

export default function ProfileLibrary(props: Props) {
  return <ProfileLibraryContent key={`${props.ownerId}:${props.tab}:${props.refresh}`} {...props}/>;
}
function ProfileLibraryContent({ ownerId, tab, refresh, busy, request, onOpenDraft, onDeleteDraft, onOpenPublication, onNew }: Props) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(tab === 'drafts' ? 10 : 12);
  const [result, setResult] = useState(() => blankPage(pageSize));
  const [completedKey, setCompletedKey] = useState('');
  const [failure, setFailure] = useState({ key: '', message: '' });
  const [retry, setRetry] = useState(0);
  const requests = useRef(new ProfileListRequests());
  const requestRef = useRef(request);
  const scope: ProfileListScope = { ownerId, session: refresh, tab, query, page, pageSize };
  const scopeRef = useRef(scope);
  useLayoutEffect(() => { requestRef.current = request; scopeRef.current = { ownerId, session: refresh, tab, query, page, pageSize }; }, [request, ownerId, refresh, tab, query, page, pageSize]);
  const loadKey = JSON.stringify([ownerId, refresh, tab, query, page, pageSize, retry]);
  const loading = completedKey !== loadKey;
  const error = failure.key === loadKey ? failure.message : '';
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const requestState = requests.current;
    const ticket = requestState.begin(scopeRef.current);
    const accepts = () => requests.current.accepts(ticket, scopeRef.current);
    const load = async (): Promise<ProfilePage<Item>> => {
      if (!STATIC_DEMO) return requestRef.current(profileListPath(tab, query, page, pageSize));
      if (tab !== 'drafts') return blankPage(pageSize);
      const all: SavedCircuit[] = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
      const matches = all.filter(item => item.title.includes(query)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
      const totalPages = Math.max(1, Math.ceil(matches.length / pageSize)), currentPage = Math.min(page, totalPages);
      return { items: matches.slice((currentPage - 1) * pageSize, currentPage * pageSize), page: currentPage, pageSize, total: matches.length, totalPages };
    };
    void load().then(next => {
      if (!accepts()) return;
      if (tab !== 'drafts' && next.page !== page) {
        // Deletions/unfavorites can shrink the list while later batches load.
        // Re-read from its start instead of retaining obsolete earlier cards.
        requests.current.invalidate(); setResult(blankPage(pageSize)); setPage(1); setRetry(value => value + 1);
        return;
      }
      setResult(previous => ({ ...next, items: tab === 'drafts' || page === 1 ? next.items : [...new Map([...previous.items, ...next.items].map(item => [item.id, item])).values()] }));
      if (tab === 'drafts' && next.page !== page) setPage(next.page);
    }).catch(reason => { if (accepts()) setFailure({ key: loadKey, message: reason instanceof Error ? reason.message : '读取失败，请重试' }); })
      .finally(() => { if (accepts()) setCompletedKey(loadKey); });
    return () => requestState.invalidate();
  }, [ownerId, tab, query, page, pageSize, refresh, retry, loadKey]);

  const more = tab !== 'drafts' && result.page < result.totalPages;
  useEffect(() => {
    if (!more || loading || error || !sentinel.current || typeof IntersectionObserver === 'undefined') return;
    let queued = false;
    const observer = new IntersectionObserver(entries => {
      if (!queued && entries.some(entry => entry.isIntersecting)) {
        queued = true;
        observer.disconnect(); requests.current.invalidate(); setPage(result.page + 1);
      }
    }, { rootMargin: '180px' });
    observer.observe(sentinel.current);
    return () => { queued = true; observer.disconnect(); };
  }, [more, loading, error, result.page]);

  function changePage(next: number) { requests.current.invalidate(); setPage(next); }
  function submit(event: FormEvent) {
    event.preventDefault(); requests.current.invalidate(); setQuery(search.trim()); setPage(1); setResult(blankPage(pageSize)); setRetry(value => value + 1);
  }
  return <div className="dt-profile-library" data-list-tab={tab} data-loaded-count={result.items.length} data-total-count={result.total}>
    <div className="dt-profile-list-tools">{tab === 'drafts' ? <><span>{result.total} 份私有草稿</span><button className="dt-text-button" onClick={onNew}>新建电路</button></> : <form role="search" aria-label={tab === 'favorites' ? '搜索收藏图纸' : '搜索我的电路'} onSubmit={submit}><label><Search size={16}/><input aria-label="搜索个人电路" placeholder="请输入电路名称" value={search} maxLength={100} onChange={event => setSearch(event.target.value)}/></label><button type="submit">搜索</button><span>共 {result.total} 个</span></form>}</div>
    {error && <div className="dt-error" role="alert">{error}<button onClick={() => { requests.current.invalidate(); setRetry(value => value + 1); }}>重试</button></div>}
    {tab === 'drafts' ? <>
      <div className="dt-profile-draft-table" aria-busy={loading}><table><thead><tr><th>标题</th><th>更新时间</th><th>操作</th></tr></thead><tbody>{!loading && (result.items as SavedCircuit[]).map(item => <tr key={item.id}><td>{item.title}</td><td>{date(item.updatedAt)}</td><td><button disabled={busy} onClick={() => onOpenDraft(item)}>编辑</button><button disabled={busy} className="dt-danger-text" onClick={() => onDeleteDraft(item)}>删除</button></td></tr>)}</tbody></table></div>
      <nav className="dt-profile-pagination" aria-label="草稿分页"><label>每页<select aria-label="每页草稿数量" value={pageSize} onChange={event => { requests.current.invalidate(); setPageSize(Number(event.target.value)); setPage(1); }} >{PROFILE_DRAFT_PAGE_SIZES.map(size => <option value={size} key={size}>{size}</option>)}</select>条</label><span>第 {result.page} / {result.totalPages} 页</span><button aria-label="上一页草稿" disabled={loading || result.page <= 1} onClick={() => changePage(result.page - 1)}><ChevronLeft size={16}/></button><button aria-label="下一页草稿" disabled={loading || result.page >= result.totalPages} onClick={() => changePage(result.page + 1)}><ChevronRight size={16}/></button></nav>
    </> : <div className="dt-profile-publication-list">{(result.items as Publication[]).map(item => <article className="dt-profile-publication" key={item.id}>
      <button className="dt-profile-publication-preview" aria-label={`查看 ${item.title}`} onClick={() => onOpenPublication(item.id)}><DocumentPreview document={item.document}/></button>
      <div className="dt-profile-publication-info"><button className="dt-card-title" onClick={() => onOpenPublication(item.id)}>{item.title}</button><p>{item.author.name || item.author.username}</p><small>{date(item.createdAt)}</small><div className="dt-profile-reaction-counts"><span><Heart size={15}/>{item.likes}</span><span><Star size={15}/>{item.favorites}</span></div></div>
    </article>)}</div>}
    {loading && <p className="dt-profile-list-status" role="status">正在读取{tab === 'drafts' ? '草稿' : tab === 'favorites' ? '收藏' : '电路'}…</p>}
    {!loading && !error && !result.items.length && <div className="dt-empty">{tab === 'drafts' ? <FolderOpen size={38}/> : <CircuitBoard size={38}/>}<h3>{tab === 'drafts' ? '草稿箱还是空的' : query ? '没有找到匹配电路' : tab === 'favorites' ? '还没有收藏图纸' : '还没有发布电路'}</h3>{tab === 'drafts' && <p>接好电路后，点击“保存草稿”。</p>}{STATIC_DEMO && tab !== 'drafts' && <p>成员作品与收藏请使用本地完整版。</p>}</div>}
    {tab !== 'drafts' && <div ref={sentinel} className="dt-profile-load-sentinel">{!loading && !error && result.items.length > 0 && <span>{more ? '继续向下滚动加载' : `已显示全部 ${result.total} 个`}</span>}{more && !loading && typeof IntersectionObserver === 'undefined' && <button onClick={() => changePage(result.page + 1)}>加载更多</button>}</div>}
  </div>;
}
