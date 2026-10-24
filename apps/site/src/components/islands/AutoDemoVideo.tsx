import { useEffect, useRef, useState } from 'react';
import { demoFilm as copy, filmState } from '../../content/demo-film';
import { Icon } from '../Icon';
import '../film/player.css';

export default function AutoDemoVideo() {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [intent, setIntent] = useState<boolean | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(0);
  const [portrait, setPortrait] = useState(false);
  const state = filmState(time);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = window.matchMedia('(max-width: 639px)');
    const preferences = () => {
      setMotionAllowed(!reduce.matches);
      setPortrait(mobile.matches);
    };
    const visibility = () => setPageVisible(!document.hidden);
    preferences();
    visibility();
    reduce.addEventListener('change', preferences);
    mobile.addEventListener('change', preferences);
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { threshold: 0.2 },
    );
    if (container.current) observer.observe(container.current);
    return () => {
      observer.disconnect();
      reduce.removeEventListener('change', preferences);
      mobile.removeEventListener('change', preferences);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: portrait replaces the video DOM node, so playback must be synchronized again.
  useEffect(() => {
    const media = video.current;
    if (!media) return;
    const shouldPlay = (intent ?? motionAllowed) && visible && pageVisible && !ended;
    if (shouldPlay && media.paused) void media.play().catch(() => setPlaying(false));
    else if (!shouldPlay && !media.paused) media.pause();
  }, [intent, motionAllowed, visible, pageVisible, ended, portrait]);

  // A source can fail before React hydrates the server-rendered video.
  // Source errors do not bubble to the video element.
  // biome-ignore lint/correctness/useExhaustiveDependencies: portrait replaces the media element.
  useEffect(() => {
    const media = video.current;
    if (!media) return;
    const source = media.querySelector('source');
    const failure = () => setFailed(true);
    source?.addEventListener('error', failure);
    if (media.error || media.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) failure();
    return () => source?.removeEventListener('error', failure);
  }, [portrait]);

  const playFrom = (seconds?: number) => {
    const media = video.current;
    if (!media) return;
    if (seconds !== undefined) {
      media.currentTime = seconds;
      setTime(seconds);
    } else if (media.ended) {
      media.currentTime = 0;
      setTime(0);
    }
    setEnded(false);
    setIntent(true);
    void media.play().catch(() => setPlaying(false));
  };
  const toggle = () => {
    if (video.current?.paused) playFrom();
    else {
      setIntent(false);
      video.current?.pause();
    }
  };

  return (
    <div ref={container} id="film" className="auto-demo" data-testid="auto-demo">
      <div className="auto-demo-header">
        <span>
          <i /> {copy.label}
        </span>
        <span>{copy.muted}</span>
      </div>
      <div className="auto-demo-screen">
        <video
          ref={video}
          key={portrait ? 'portrait' : 'landscape'}
          controls
          muted
          playsInline
          preload="metadata"
          poster={portrait ? '/demo/product-portrait.webp' : '/demo/product-landscape.webp'}
          aria-label={copy.title}
          data-testid="product-video"
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onError={() => setFailed(true)}
          onLoadedMetadata={() => setFailed(false)}
          onPlay={() => {
            setPlaying(true);
            if (!motionAllowed || intent === false) setIntent(true);
          }}
          onPause={(event) => {
            setPlaying(false);
            if (visible && pageVisible && !event.currentTarget.ended) setIntent(false);
          }}
          onEnded={() => {
            setEnded(true);
            setIntent(false);
            setPlaying(false);
          }}
        >
          <source
            src={portrait ? '/demo/product-portrait.mp4' : '/demo/product-landscape.mp4'}
            type="video/mp4"
          />
          <track kind="captions" src="/demo/product-fr.vtt" srcLang="fr" label="Français" />
          {copy.fallback}
        </video>
      </div>
      <div className="auto-demo-caption" data-testid="film-caption">
        <span>{String(state.scene + 1).padStart(2, '0')} / 06</span>
        <p>{failed ? copy.loadError : state.step.caption}</p>
      </div>
      <div className="auto-demo-controls">
        <button type="button" onClick={toggle} aria-label={playing ? copy.pause : copy.play}>
          {playing ? (
            <span className="auto-demo-pause" aria-hidden="true">
              Ⅱ
            </span>
          ) : (
            <Icon name="play" size={14} />
          )}
          {playing ? copy.pauseShort : ended ? copy.replay : copy.playShort}
        </button>
        <button type="button" onClick={() => playFrom(0)} aria-label={copy.replay}>
          <Icon name="refresh" size={15} />
        </button>
        <span className="auto-demo-time">{String(Math.floor(time)).padStart(2, '0')} / 36 s</span>
        <a href="#demo">
          {copy.interactive}
          <Icon name="arrowRight" size={14} />
        </a>
      </div>
      <fieldset className="auto-demo-chapters" aria-label={copy.title}>
        {copy.steps.map((step, i) => (
          <button
            type="button"
            key={step.id}
            onClick={() => playFrom(step.start)}
            aria-label={`${i + 1}. ${step.short}`}
            aria-current={state.scene === i ? 'step' : undefined}
            title={step.short}
          >
            <span />
            <span className="sr-only">{step.short}</span>
          </button>
        ))}
      </fieldset>
      <p className="auto-demo-disclaimer">{copy.note}</p>
      <details className="auto-demo-transcript">
        <summary>{copy.transcript}</summary>
        <ol>
          {copy.steps.map((step) => (
            <li key={step.id}>
              <strong>{step.short}.</strong> {step.caption}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
