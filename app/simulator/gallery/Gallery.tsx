'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, CircuitBoard, Copy, Heart, Link, Search, ShieldCheck, Star, X } from 'lucide-react';
import DocumentPreview from '../editor/DocumentPreview';
import { jsonBody, STATIC_DEMO, type Publication } from '../api';
import { APP_LOCATION_CHANGED, emptyGalleryRoute, galleryHref, galleryListPath, galleryRouteFromSearch, navigateAppLocation, type GalleryRoute } from './route';
import { GalleryRequestState } from './request-state';
import './gallery.css';
import Modal from '../Modal';

type Page = { items: Publication[]; page: number; pageSize: number; total: number; totalPages: number };
type Props = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  onFork: (id: string) => void;
  onPractice: () => void;
  busy?: boolean;
};
const date = (value: string | number) => new Date(value).toLocaleString('zh-CN', { hour12: false });
function subscribeLocation(changed: () => void) {
  addEventListener('popstate', changed); addEventListener(APP_LOCATION_CHANGED, changed);
  return () => { removeEventListener('popstate', changed); removeEventListener(APP_LOCATION_CHANGED, changed); };
}
const noopSubscribe = () => () => {};

export default function Gallery({ request, onFork, onPractice, busy = false }: Props) {
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const routeSearch = useSyncExternalStore(subscribeLocation, () => location.search, () => '');
  const route = galleryRouteFromSearch(routeSearch);
  const [searchState, setSearchState] = useState({ query: route.query, value: route.query });
  const search = searchState.query === route.query ? searchState.value : route.query;
  const [page, setPage] = useState<Page | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [failure, setFailure] = useState({ key: '', message: '' });
  const [detail, setDetail] = useState<Publication | null>(null);
  const [detailFailure, setDetailFailure] = useState({ key: '', message: '' });
  const [feedbackState, setFeedbackState] = useState({ key: '', message: '' });
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<string[]>([]);
  const pendingRef = useRef(new Set<string>());
  const requests = useRef(new GalleryRequestState());
  const mounted = useRef(true);
  const requestRef = useRef(request);
  useLayoutEffect(() => { requestRef.current = request; }, [request]);
  const listKey = galleryListPath(route);
  const shownPage = loadedKey === listKey ? page : null;
  const shownDetail = detail?.id === route.publicationId ? detail : null;
  const errorKey = `${listKey}:${reload}`, detailKey = `${route.publicationId}:${reload}`;
  const error = failure.key === errorKey ? failure.message : '';
  const detailError = detailFailure.key === detailKey ? detailFailure.message : '';
  const feedback = feedbackState.key === galleryHref(route) ? feedbackState.message : '';
  const setFeedback = (message: string) => setFeedbackState({ key: galleryHref(route), message });

  useEffect(() => {
    mounted.current = true;
    const requestState = requests.current;
    return () => { mounted.current = false; requestState.clear(); };
  }, []);
  useEffect(() => {
    requests.current.retain([
      ...(page?.items.map(item => item.id) ?? []),
      ...(route.publicationId ? [route.publicationId] : []),
      ...pending.map(key => key.slice(0, key.lastIndexOf(':'))),
    ]);
  }, [page, route.publicationId, pending]);
  useEffect(() => {
    if (!ready || STATIC_DEMO) return;
    const abort = new AbortController(); let active = true;
    const requestState = requests.current;
    const readVersion = requestState.beginRead();
    void requestRef.current<Page>(listKey, { signal: abort.signal }).then(result => {
      if (!active || galleryListPath(galleryRouteFromSearch(location.search)) !== listKey) return;
      if (result.page !== route.page) {
        const current = galleryRouteFromSearch(location.search);
        if (galleryListPath(current) !== listKey) return;
        const corrected = { ...current, page: result.page };
        navigateAppLocation(galleryHref(corrected), { replace: true, state: history.state });
        return;
      }
      setFailure({ key: errorKey, message: '' });
      setPage({ ...result, items: result.items.map(item => requests.current.acceptRead(item, readVersion)) }); setLoadedKey(listKey);
    }).catch(failure => { if (active) { setPage(null); setLoadedKey(listKey); setFailure({ key: errorKey, message: failure instanceof Error ? failure.message : '作品加载失败，请重试' }); } }).finally(() => requestState.finishRead(readVersion));
    return () => { active = false; requestState.finishRead(readVersion); abort.abort(); };
  }, [ready, listKey, reload, route.page, errorKey]);
  useEffect(() => {
    if (!ready || !route.publicationId || STATIC_DEMO) return;
    const abort = new AbortController(); let active = true;
    const requestState = requests.current;
    const readVersion = requestState.beginRead(route.publicationId);
    void requestRef.current<{ publication: Publication }>(`/publications/${encodeURIComponent(route.publicationId)}`, { signal: abort.signal }).then(result => {
      if (active && galleryRouteFromSearch(location.search).publicationId === route.publicationId) setDetail(requests.current.acceptRead(result.publication, readVersion));
    }).catch(failure => { if (active) setDetailFailure({ key: detailKey, message: failure instanceof Error ? failure.message : '作品加载失败，请重试' }); }).finally(() => requestState.finishRead(readVersion));
    return () => { active = false; requestState.finishRead(readVersion); abort.abort(); };
  }, [ready, route.publicationId, reload, detailKey]);

  function go(next: GalleryRoute) {
    const href = galleryHref(next);
    if (href === `${location.pathname}${location.search}`) return;
    const returnTo = next.publicationId && !route.publicationId ? galleryHref(route) : undefined;
    navigateAppLocation(href, { state: { galleryReturn: returnTo } });
  }
  function follow(event: MouseEvent<HTMLAnchorElement>, next: GalleryRoute) {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); go(next);
  }
  function closeDetail() {
    const next = { ...route, publicationId: undefined };
    if (history.state?.galleryReturn === galleryHref(next)) history.back();
    else navigateAppLocation(galleryHref(next), { replace: true });
  }
  async function reactTo(item: Publication, kind: 'like' | 'favorite') {
    const key = `${item.id}:${kind}`;
    if ([...pendingRef.current].some(value => value.startsWith(`${item.id}:`))) return;
    pendingRef.current.add(key); setPending([...pendingRef.current]); setFeedback('');
    try {
      const current = requests.current.current(item);
      const result = await requestRef.current<{ publication: Publication }>(`/publications/${encodeURIComponent(item.id)}/${kind}`, jsonBody({ active: !(kind === 'like' ? current.liked : current.favorited) }));
      if (!mounted.current) return;
      const updated = requests.current.acknowledgeMutation(result.publication);
      setPage(current => current ? { ...current, items: current.items.map(value => value.id === item.id ? updated : value) } : current);
      setDetail(current => current?.id === item.id ? updated : current);
    } catch (failure) { if (mounted.current) setFeedback(failure instanceof Error ? failure.message : '操作失败，请重试'); }
    finally { pendingRef.current.delete(key); if (mounted.current) setPending([...pendingRef.current]); }
  }
  function reactions(item: Publication) {
    const waiting = pending.some(value => value.startsWith(`${item.id}:`));
    return <><button aria-label={`点赞 ${item.title}`} aria-pressed={item.liked} className={item.liked ? 'active' : ''} disabled={waiting} onClick={() => void reactTo(item, 'like')}><Heart size={16}/>{item.likes}</button><button aria-label={`收藏 ${item.title}`} aria-pressed={item.favorited} className={item.favorited ? 'active' : ''} disabled={waiting} onClick={() => void reactTo(item, 'favorite')}><Star size={16}/>{item.favorites}</button></>;
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(new URL(galleryHref(route), location.origin).href); if (mounted.current) setFeedback('作品链接已复制，仅登录成员可访问'); }
    catch { if (mounted.current) setFeedback('复制失败，可直接复制浏览器地址栏中的作品链接'); }
  }

  return <main className="dt-page dt-gallery">
    <div className="dt-page-heading"><div><h1>仿真广场</h1><p>分享你的接线作品，发现更多电路思路</p></div><form className="dt-gallery-search" onSubmit={event => { event.preventDefault(); go({ query: search.trim(), page: 1 }); }}><label className="dt-search"><Search size={18}/><input aria-label="搜索成员电路" placeholder="搜索标题、说明或作者" maxLength={100} value={search} onChange={event => setSearchState({ query: route.query, value: event.target.value })}/></label><button type="submit" className="dt-primary" disabled={STATIC_DEMO}>搜索</button></form></div>
    <div className="dt-tabs"><button className="active" onClick={() => go(emptyGalleryRoute())}>成员电路</button><span>最新发布{shownPage ? ` · 共 ${shownPage.total} 个作品` : ''}</span></div>
    {STATIC_DEMO ? <div className="dt-empty"><ShieldCheck size={44}/><h3>成员广场需要本地账号服务</h3><p>静态演示不上传、不展示私人草稿。</p></div> : <>
      {route.query && <div className="dt-gallery-query">搜索“{route.query}”<button onClick={() => go(emptyGalleryRoute())}>清除搜索</button></div>}
      {error ? <div className="dt-empty" role="alert"><p>{error}</p><button onClick={() => setReload(value => value + 1)}>重新加载</button></div> : !shownPage ? <div className="dt-empty" role="status">正在加载成员电路…</div> : shownPage.items.length ? <div className="dt-card-grid">{shownPage.items.map(item => {
        const next = { ...route, publicationId: item.id };
        return <article className="dt-circuit-card" key={item.id}><a className="dt-card-preview" href={galleryHref(next)} onClick={event => follow(event, next)} aria-label={`查看 ${item.title}`}><DocumentPreview document={item.document}/></a><div className="dt-card-content"><a className="dt-card-title" href={galleryHref(next)} onClick={event => follow(event, next)}>{item.title}</a><p>{item.author?.name || item.author?.username}<span>{date(item.createdAt)}</span></p><div className="dt-card-actions">{reactions(item)}<button disabled={busy} onClick={() => onFork(item.id)}><Copy size={16}/>复制练习</button></div></div></article>;
      })}</div> : <div className="dt-empty"><CircuitBoard size={45}/><h3>{route.query ? '没有找到匹配的电路' : '这里还没有电路'}</h3><p>{route.query ? '换一个标题、说明或作者关键词试试。' : '在模拟电路中完成接线，再发布到成员广场。'}</p>{!route.query && <button className="dt-primary" onClick={onPractice}>去接线</button>}</div>}
      {shownPage && shownPage.total > 0 && <nav className="dt-gallery-pagination" aria-label="广场分页"><button disabled={shownPage.page <= 1} onClick={() => go({ ...route, page: shownPage.page - 1, publicationId: undefined })}><ArrowLeft size={16}/>上一页</button><span>第 {shownPage.page} / {shownPage.totalPages} 页 · 每页 {shownPage.pageSize} 个</span><button disabled={shownPage.page >= shownPage.totalPages} onClick={() => go({ ...route, page: shownPage.page + 1, publicationId: undefined })}>下一页<ArrowRight size={16}/></button></nav>}
    </>}
    {feedback && !route.publicationId && <p className="dt-gallery-feedback" role="status">{feedback}</p>}
    {route.publicationId && !STATIC_DEMO && <Modal role="dialog" title={shownDetail?.title || '电路作品详情'} className="dt-modal dt-gallery-detail" onClose={closeDetail}><header><h2>{shownDetail?.title || '电路作品详情'}</h2><button aria-label="关闭作品详情" onClick={closeDetail}><X size={20}/></button></header>{detailError ? <div role="alert"><p>{detailError}</p><button onClick={() => setReload(value => value + 1)}>重新加载</button></div> : !shownDetail ? <p role="status">正在加载作品…</p> : <><p>作者：{shownDetail.author.name} · {date(shownDetail.createdAt)}</p><div className="dt-publication-preview"><DocumentPreview document={shownDetail.document}/></div><div className="dt-modal-actions">{reactions(shownDetail)}<button onClick={() => void copyLink()}><Link size={16}/>复制链接</button><button className="dt-primary" disabled={busy} onClick={() => onFork(shownDetail.id)}>复制到我的草稿并打开</button></div><p className="dt-hint">此作品保存的是发布时的独立接线快照。</p></>}{feedback && <p className="dt-gallery-feedback" role="status">{feedback}</p>}</Modal>}
  </main>;
}
