/** Прямі трансляції закладу: список (адмін створює й видаляє) і екран ведучого — камера телефона/ноутбука на телевізори. */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { api, type LiveStream, type Org } from "../api.ts";
import { Btn, Card, ErrorBox, useAction } from "../components/ui.tsx";
import { h264Supported, publish, WhipError, type WhipSession } from "../live/whip.ts";

export function LiveList({ org }: { org: Org }) {
  const [list, setList] = useState<LiveStream[] | null>(null);
  const canEdit = org.role !== "staff";
  const load = async () => setList(await api.get<LiveStream[]>(`/api/orgs/${org.id}/live`));
  useEffect(() => { void load(); }, [org.id]);

  const create = useAction(async () => {
    const name = prompt("Назва трансляції", list?.length ? `Трансляція ${list.length + 1}` : "Зал");
    if (name) { await api.post(`/api/orgs/${org.id}/live`, { name }); await load(); }
  });
  const rotate = useAction(async (s: LiveStream) => {
    if (confirm(`Перевипустити ключ «${s.name}»? Відкриті сторінки ведучого доведеться оновити.`)) { await api.post(`/api/orgs/${org.id}/live/${s.id}/rotate-key`); await load(); }
  });
  const del = useAction(async (s: LiveStream) => {
    if (confirm(`Видалити трансляцію «${s.name}»? Віджети з нею на екранах перестануть працювати.`)) { await api.del(`/api/orgs/${org.id}/live/${s.id}`); await load(); }
  });

  return <Card title="Трансляції" actions={canEdit && <Btn kind="primary" onClick={() => create.run(undefined)}>+ Трансляція</Btn>}>
    <p className="muted small">
      Камера й мікрофон телефона чи ноутбука — наживо на телевізори закладу. Відкрийте трансляцію на пристрої,
      з якого знімаєте, і натисніть «Почати». На екрані додайте віджет «Пряма трансляція» і виберіть її.
      Затримка — кілька секунд.
    </p>
    <ErrorBox err={create.err ?? rotate.err ?? del.err} />
    {list === null ? <p className="muted">Завантаження…</p>
      : list.length === 0 ? <div className="empty">{canEdit ? "Ще немає трансляцій. Створіть першу." : "Адміністратор ще не створив жодної трансляції."}</div>
      : <table className="tbl"><thead><tr><th>Назва</th><th /></tr></thead>
        <tbody>{list.map((s) => <tr key={s.id}>
          <td><Link href={`/o/${org.id}/live/${s.id}`} className="dev-name">{s.name}</Link></td>
          <td className="actions">
            <Link href={`/o/${org.id}/live/${s.id}`} className="btn btn-sm btn-primary">● Вести</Link>
            {canEdit && <Btn kind="ghost" onClick={() => rotate.run(s)} title="Новий ключ публікації">Новий ключ</Btn>}
            {canEdit && <Btn kind="ghost" onClick={() => del.run(s)}>Видалити</Btn>}
          </td>
        </tr>)}</tbody></table>}
  </Card>;
}

type Phase = "idle" | "connecting" | "live" | "reconnecting";
const PHASE: Record<Phase, [string, string]> = {
  idle: ["pill-off", "не в ефірі"], connecting: ["pill-warn", "підключення…"], live: ["pill-live", "в ефірі"], reconnecting: ["pill-warn", "перепідключення…"],
};
/** Скільки чекати, поки «disconnected» саме не стане «connected», перш ніж підключатись заново. */
const DISCONNECT_GRACE_MS = 5000;
const RETRY_MS = 3000;

const VIDEO: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export function Broadcaster({ org, streamId }: { org: Org; streamId: string }) {
  const [stream, setStream] = useState<LiveStream | null | undefined>(undefined);
  const [media, setMedia] = useState<MediaStream | null>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState<string>("");
  const [facing, setFacing] = useState<"user" | "environment" | null>(null);
  const [mic, setMic] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState<unknown>(null);
  const [portrait, setPortrait] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<WhipSession | null>(null);
  const wanted = useRef(false);        // ведучий натиснув «Почати» і не натискав «Зупинити»
  const timers = useRef<number[]>([]);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  mediaRef.current = media;

  useEffect(() => {
    void api.get<LiveStream[]>(`/api/orgs/${org.id}/live`).then((l) => setStream(l.find((s) => s.id === streamId) ?? null)).catch(setErr);
  }, [org.id, streamId]);

  // камера й мікрофон: дозвіл просимо одразу, щоб ведучий бачив кадр до ефіру
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Браузер не дає доступу до камери (потрібен https і сучасний браузер)");
        const ms = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, facingMode: "environment" }, audio: AUDIO });
        if (!alive) { ms.getTracks().forEach((t) => t.stop()); return; }
        setMedia(ms);
        const v = ms.getVideoTracks()[0];
        setCamId(v?.getSettings().deviceId ?? "");
        setFacing((v?.getSettings().facingMode as "user" | "environment" | undefined) ?? null);
        setCams((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"));
      } catch (e) { setErr(e instanceof DOMException && e.name === "NotAllowedError" ? new Error("Доступ до камери чи мікрофона заборонено — дозвольте його в налаштуваннях браузера") : e); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (video.current && media) video.current.srcObject = media; }, [media]);
  useEffect(() => () => { void stopAll(); mediaRef.current?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (!since) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [since]);
  // поки в ефірі — не закривати сторінку випадково
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (wanted.current) e.preventDefault(); };
    addEventListener("beforeunload", leave); return () => removeEventListener("beforeunload", leave);
  }, []);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  const connect = async () => {
    if (!wanted.current || !stream || !mediaRef.current) return;
    try {
      const s = await publish(mediaRef.current, stream.whipUrl, stream.publishKey);
      if (!wanted.current) { await s.stop(); return; }
      session.current = s;
      const onState = () => {
        if (session.current !== s) return;
        const st = s.pc.connectionState;
        if (st === "connected") { clearTimers(); setPhase("live"); setSince((x) => x ?? Date.now()); }
        else if (st === "failed") reconnect();
        else if (st === "disconnected") later(() => { if (session.current === s && s.pc.connectionState !== "connected") reconnect(); }, DISCONNECT_GRACE_MS);
      };
      s.pc.addEventListener("connectionstatechange", onState);
      onState();   // з'єднання могло встановитись ще до підписки (поки publish дочікувався відповіді)
    } catch (e) {
      if (e instanceof WhipError && (e.status === 401 || e.status === 403)) { wanted.current = false; setPhase("idle"); setSince(null); setErr(e); return; }
      setPhase("reconnecting"); later(() => void connect(), RETRY_MS);
    }
  };
  const reconnect = () => {
    const old = session.current; session.current = null;
    void old?.stop();
    if (!wanted.current) return;
    setPhase("reconnecting"); clearTimers(); later(() => void connect(), RETRY_MS);
  };
  const stopAll = async () => {
    wanted.current = false; clearTimers();
    const s = session.current; session.current = null;
    await s?.stop();
    await wake.current?.release().catch(() => {}); wake.current = null;
  };

  const start = async () => {
    setErr(null); wanted.current = true; setPhase("connecting"); setSince(null);
    // екран телефона не гасне, поки йде ефір
    try { wake.current = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* немає — не страшно */ }
    await connect();
  };
  const stop = async () => { await stopAll(); setPhase("idle"); setSince(null); };

  /** Інша камера без нового підключення: міняємо доріжку і в перегляді, і в ефірі. */
  const switchCam = async (id: string) => {
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, deviceId: { exact: id } } });
      const nt = ms.getVideoTracks()[0]!;
      const cur = mediaRef.current!;
      const old = cur.getVideoTracks()[0];
      if (old) { cur.removeTrack(old); old.stop(); }
      cur.addTrack(nt);
      await session.current?.video?.replaceTrack(nt);
      if (video.current) video.current.srcObject = cur;
      setCamId(id); setFacing((nt.getSettings().facingMode as "user" | "environment" | undefined) ?? null);
    } catch (e) { setErr(e); }
  };
  const flip = () => { const i = cams.findIndex((c) => c.deviceId === camId); const next = cams[(i + 1) % cams.length]; if (next) void switchCam(next.deviceId); };
  const toggleMic = () => { const a = media?.getAudioTracks()[0]; if (a) { a.enabled = !mic; setMic(!mic); } };

  if (stream === null) return <Card title="Трансляція"><p>Трансляцію не знайдено. <Link href={`/o/${org.id}/live`}>До списку</Link></p></Card>;
  const [cls, label] = PHASE[phase];
  const on = phase !== "idle";
  const dur = since ? Math.floor((now - since) / 1000) : 0;
  const hasMic = !!media?.getAudioTracks().length;

  return <div className="live">
    <div className="live-top">
      <Link href={`/o/${org.id}/live`} className="btn btn-ghost" onClick={(e) => { if (wanted.current && !confirm("Зупинити трансляцію і вийти?")) e.preventDefault(); }}>← Трансляції</Link>
      <h2 className="grow">{stream?.name ?? "…"}</h2>
      <span className={`pill ${cls}`}>{label}{phase === "live" && ` · ${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, "0")}`}</span>
    </div>
    <div className={`live-stage${facing === "user" ? " mirror" : ""}`}>
      <video ref={video} autoPlay muted playsInline onResize={(e) => { const v = e.currentTarget; setPortrait(v.videoHeight > v.videoWidth); }} />
      {!media && !err && <div className="live-msg">Дозвольте доступ до камери й мікрофона…</div>}
    </div>
    <ErrorBox err={err} />
    {portrait && <div className="live-tip">Кадр вертикальний — на телевізорі буде вузька смуга. Поверніть телефон горизонтально.</div>}
    {!h264Supported() && <div className="error">Цей браузер не вміє H.264 — телевізори такого відео не покажуть. Відкрийте сторінку в Chrome, Safari чи Edge.</div>}
    <div className="live-bar">
      {cams.length > 1 && <>
        <Btn onClick={flip} title="Наступна камера">⟲ Камера</Btn>
        <select value={camId} onChange={(e) => void switchCam(e.currentTarget.value)}>
          {cams.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `Камера ${i + 1}`}</option>)}
        </select>
      </>}
      <Btn kind={mic ? "default" : "danger"} onClick={toggleMic} disabled={!hasMic} title={hasMic ? undefined : "Мікрофона немає"}>{mic && hasMic ? "🎙 Мікрофон" : "🔇 Без звуку"}</Btn>
      <div className="grow" />
      {on ? <Btn kind="danger" onClick={() => void stop()}>■ Зупинити</Btn>
        : <Btn kind="primary" onClick={() => void start()} disabled={!media || !stream}>● Почати</Btn>}
    </div>
    <p className="muted small">Поки йде ефір, не закривайте сторінку й не блокуйте телефон. Зник інтернет — трансляція підключиться сама.</p>
  </div>;
}
