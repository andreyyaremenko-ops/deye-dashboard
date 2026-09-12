/**
 * Відеофон. Два <video> по черзі з кросфейдом: один <video loop> на старих ТБ
 * дає провал на стику. За 0.8 с до кінця стартує другий, перший гасне.
 * Watchdog: якщо currentTime не рухається 10 с — перезавантажуємо src.
 */
import { useEffect, useRef } from "preact/hooks";

export function VideoBackground({ src }: { src: string }) {
  const a = useRef<HTMLVideoElement>(null), b = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = [a.current!, b.current!];
    let active = 0, lastT = -1, stuck = 0, timer: number | undefined;
    for (const el of v) { el.src = src; el.muted = true; el.playsInline = true; el.preload = "auto"; el.load(); }
    v[0]!.classList.add("on");
    v[0]!.play().catch(() => { /* autoplay muted зазвичай дозволений */ });

    const check = () => {
      const cur = v[active]!, next = v[1 - active]!;
      if (cur.duration && cur.duration - cur.currentTime < 0.8 && next.paused) {
        next.currentTime = 0;
        next.play().then(() => { next.classList.add("on"); cur.classList.remove("on"); active = 1 - active; setTimeout(() => { cur.pause(); }, 900); }).catch(() => {});
      }
      if (cur.currentTime === lastT && !cur.paused) { if (++stuck >= 40) { stuck = 0; cur.load(); cur.play().catch(() => {}); } }
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
