/**
 * Відеофон. Два <video> по черзі з кросфейдом: один <video loop> на старих ТБ дає провал на стику.
 * Друге відео підвантажується лише за 3 с до кінця першого (половина трафіку/декодування на старті).
 * Стійкість: помилка декодування або 20 с без руху кадру -> градієнт замість відео, повтор через 5 хв.
 */
import { useEffect, useRef, useState } from "preact/hooks";

export function VideoBackground({ src, onFail }: { src: string; onFail?: () => void }) {
  const a = useRef<HTMLVideoElement>(null), b = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = [a.current!, b.current!];
    let active = 0, lastT = -1, stuck = 0, timer: number | undefined, nextReady = false, failed = false;
    const fail = (why: string) => { if (failed) return; failed = true; clearInterval(timer); for (const el of v) { el.pause(); el.removeAttribute("src"); el.load(); } console.warn("video background disabled:", why); onFail?.(); };
    for (const el of v) { el.muted = true; el.playsInline = true; el.addEventListener("error", () => fail("error " + (el.error?.code ?? "?"))); }
    v[0]!.preload = "auto"; v[0]!.src = src; v[0]!.load();
    v[0]!.classList.add("on");
    v[0]!.play().catch(() => { /* muted autoplay зазвичай дозволений; інакше спрацює watchdog */ });

    const check = () => {
      const cur = v[active]!, next = v[1 - active]!;
      if (cur.duration && !nextReady && cur.duration - cur.currentTime < 3) { next.preload = "auto"; next.src = src; next.load(); nextReady = true; }
      if (cur.duration && cur.duration - cur.currentTime < 0.8 && next.paused && nextReady) {
        next.currentTime = 0;
        next.play().then(() => { next.classList.add("on"); cur.classList.remove("on"); active = 1 - active; nextReady = false; setTimeout(() => { cur.pause(); cur.removeAttribute("src"); cur.load(); }, 900); }).catch(() => {});
      }
      if (cur.currentTime === lastT) { if (++stuck >= 80) fail("stalled 20s"); }   // 80 × 250 мс
      else { stuck = 0; lastT = cur.currentTime; }
    };
    timer = window.setInterval(check, 250);
    return () => { clearInterval(timer); for (const el of v) { el.pause(); el.removeAttribute("src"); el.load(); } };
  }, [src]);
  return <div class="bg">
    <video ref={a} class="bgv" muted playsInline />
    <video ref={b} class="bgv" muted playsInline />
  </div>;
}

/** Без відео: спокійний градієнт, щоб екран не був чорним. */
export function GradientBackground() {
  return <div class="bg bg-gradient" />;
}

/** Обгортка: відео з відкатом на градієнт і повторною спробою через 5 хв. */
export function Background({ src }: { src: string | null }) {
  const [failedAt, setFailedAt] = useState<number | null>(null);
  useEffect(() => { if (failedAt === null) return; const t = setTimeout(() => setFailedAt(null), 5 * 60_000); return () => clearTimeout(t); }, [failedAt]);
  if (!src || failedAt !== null) return <GradientBackground />;
  return <VideoBackground src={src} onFail={() => setFailedAt(Date.now())} />;
}
