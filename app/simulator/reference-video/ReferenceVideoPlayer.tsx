'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw, Video } from 'lucide-react';
import type { ReferenceVideo } from './catalog';
import { VIDEO_RATES, videoSeekTarget } from './controls';
import './reference-video.css';

function Player({ video }: { video: ReferenceVideo & { url: string } }) {
  const element = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const media = element.current;
    // React's development effect replay runs cleanup without removing the DOM.
    if (media && media.getAttribute('src') !== video.url) media.setAttribute('src', video.url);
    return () => {
      // Switching a diagram/tab or closing a window must stop its sound and request.
      if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
    };
  }, [video.url]);
  function seek(seconds: number) {
    const media = element.current;
    if (!media) return;
    const target = videoSeekTarget(media.currentTime, media.duration, seconds);
    if (target !== null) media.currentTime = target;
  }
  return <div className="dt-reference-video">
    <video ref={element} src={video.url} controls playsInline preload="metadata" crossOrigin="anonymous"
      aria-label={`${video.title}教学视频`}
      onLoadedMetadata={event => { setDuration(event.currentTarget.duration); setFailed(false); }}
      onDurationChange={event => setDuration(event.currentTarget.duration)}
      onEmptied={() => setDuration(0)}
      onRateChange={event => setSpeed(event.currentTarget.playbackRate)}
      onError={() => setFailed(true)} />
    <div className="dt-reference-video-controls" aria-label="视频快捷操作">
      <button type="button" disabled={!Number.isFinite(duration) || duration <= 0 || failed} onClick={() => seek(-10)}><RotateCcw size={15}/>后退 10 秒</button>
      <label>倍速<select aria-label="视频播放速度" value={speed} onChange={event => { const rate = Number(event.target.value); if (element.current) element.current.playbackRate = rate; setSpeed(rate); }}>{VIDEO_RATES.map(rate => <option value={rate} key={rate}>{rate}×</option>)}</select></label>
      <button type="button" disabled={!Number.isFinite(duration) || duration <= 0 || failed} onClick={() => seek(10)}>前进 10 秒<RotateCw size={15}/></button>
    </div>
    {failed && <div className="dt-reference-video-error" role="alert"><span>视频暂时无法加载，请检查网络后重试。</span><button type="button" onClick={() => { setFailed(false); element.current?.load(); }}>重新加载</button></div>}
    <p className="dt-reference-video-note">原图纸教学视频 · 在线播放，需连接网络</p>
  </div>;
}

export default function ReferenceVideoPlayer({ video }: { video?: ReferenceVideo }) {
  if (!video?.url) return <div className="dt-reference-video-empty"><Video size={38}/><b>暂无视频</b><p>当前图纸尚未提供对应教学视频。</p></div>;
  return <Player key={video.url} video={{ ...video, url: video.url }}/>;
}
