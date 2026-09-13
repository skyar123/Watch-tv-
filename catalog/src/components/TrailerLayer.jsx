import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

/**
 * The autoplaying trailer behind a feed card.
 *
 * Rules baked in here:
 *
 *  • YouTube's terms require playback in their player, and TMDB gives us a
 *    YouTube key, so this is an IFrame API embed and not a raw video file.
 *  • iOS only permits inline autoplay when muted. `mute=1` and `playsinline=1`
 *    are not styling — without them the video simply never starts, or Safari
 *    takes it fullscreen. Unmuting is a user gesture, which is what the button
 *    is for.
 *  • The backdrop still renders underneath, always. If the embed is slow,
 *    blocked, region-locked or the show has no trailer at all, the card is a
 *    poster rather than a black box.
 *  • Only mount this for the centred card. The parent tears it down otherwise;
 *    a stack of decoding players is how a long scroll kills a phone.
 */

let apiPromise = null;
function loadYouTubeAPI() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => reject(new Error('YouTube IFrame API blocked'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('YouTube IFrame API timed out')), 12000);
  }).catch(err => { apiPromise = null; throw err; });
  return apiPromise;
}

export default function TrailerLayer({ videoKey, active, muted, onToggleMute, onState }) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const [phase, setPhase] = useState('idle');   // idle | loading | playing | failed

  useEffect(() => {
    if (!active || !videoKey) return;
    let cancelled = false;
    let player = null;
    setPhase('loading');

    loadYouTubeAPI().then(YT => {
      if (cancelled || !hostRef.current) return;
      player = new YT.Player(hostRef.current, {
        videoId: videoKey,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          autoplay: 1,
          mute: 1,               // required for iOS inline autoplay, full stop
          playsinline: 1,        // otherwise Safari goes fullscreen on play
          controls: 0,
          loop: 1,
          playlist: videoKey,    // single-video loop needs the id repeated here
          modestbranding: 1,
          rel: 0,
          fs: 0,
          disablekb: 1,
          iv_load_policy: 3,
          cc_load_policy: 0,
        },
        events: {
          onReady: e => {
            if (cancelled) { e.target.destroy?.(); return; }
            playerRef.current = e.target;
            e.target.mute();
            e.target.playVideo();
          },
          onStateChange: e => {
            if (cancelled) return;
            if (e.data === window.YT.PlayerState.PLAYING) { setPhase('playing'); onState?.('playing'); }
            // A looped single video can still fire ENDED on some clients.
            if (e.data === window.YT.PlayerState.ENDED) e.target.playVideo();
          },
          onError: () => {
            // Embedding disabled, region-locked, or the video is gone. The
            // backdrop underneath is already on screen, so just stop.
            if (!cancelled) { setPhase('failed'); onState?.('failed'); }
          },
        },
      });
    }).catch(() => { if (!cancelled) { setPhase('failed'); onState?.('failed'); } });

    return () => {
      cancelled = true;
      onState?.('idle');
      try { playerRef.current?.destroy?.(); } catch { /* already gone */ }
      try { player?.destroy?.(); } catch { /* not constructed yet */ }
      playerRef.current = null;
    };
  }, [videoKey, active, onState]);

  // Mute is driven from the parent so only one card can ever be audible.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    try { muted ? p.mute() : p.unMute(); } catch { /* player torn down mid-flight */ }
  }, [muted, phase]);

  if (!videoKey) return null;

  return (
    <>
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity duration-700
                    ${phase === 'playing' ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden="true"
      >
        {/* 16:9 scaled to cover a 9:19.5 phone. The overscan is deliberate:
            letterboxing a trailer inside a full-bleed card looks broken. */}
        <div className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2
                        overflow-hidden">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                          aspect-video w-[177.78vh] min-w-full">
            <div ref={hostRef} className="h-full w-full" />
          </div>
        </div>
      </div>

      {phase === 'playing' && (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onToggleMute?.(); }}
          className="tap absolute right-3 rounded-full glass border border-white/15
                     text-white/90 active:scale-95 transition"
          style={{ top: 'calc(env(safe-area-inset-top) + 3.75rem)' }}
          aria-label={muted ? 'Unmute trailer' : 'Mute trailer'}
        >
          {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
        </button>
      )}
    </>
  );
}
