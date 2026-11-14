/**
 * Публікація камери в MediaMTX по WHIP (WebRTC-HTTP Ingestion): одна пропозиція SDP з усіма кандидатами
 * (без trickle — простіше і надійніше через проксі), відповідь сервера — і медіа йде напряму на ICE-порт.
 *
 * Відео — лише H.264: MediaMTX кладе його в HLS без перекодування, а VP8 телевізори не грають.
 * Звук Opus перепаковує в AAC ffmpeg на сервері (deploy/mediamtx/tv.sh).
 */

/** ~2.5 Мбіт/с на 720p: досить для залу, і мобільний інтернет витягує. */
const MAX_BITRATE = 2_500_000;
const ICE_GATHER_MS = 3000;

export interface WhipSession { pc: RTCPeerConnection; video: RTCRtpSender | null; audio: RTCRtpSender | null; stop: () => Promise<void> }

export class WhipError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export const h264Supported = () => !!RTCRtpSender.getCapabilities?.("video")?.codecs.some((c) => c.mimeType.toLowerCase() === "video/h264");

function preferH264(t: RTCRtpTransceiver) {
  const caps = RTCRtpSender.getCapabilities?.("video");
  const h264 = caps?.codecs.filter((c) => c.mimeType.toLowerCase() === "video/h264") ?? [];
  // спершу baseline/packetization-mode=1 — його точно розбирає і MediaMTX, і старі ТБ
  h264.sort((a, b) => score(b) - score(a));
  if (h264.length && t.setCodecPreferences) t.setCodecPreferences(h264);
}
const score = (c: RTCRtpCodec) => (c.sdpFmtpLine?.includes("packetization-mode=1") ? 2 : 0) + (c.sdpFmtpLine?.includes("profile-level-id=42") ? 1 : 0);

function gathered(pc: RTCPeerConnection) {
  return new Promise<void>((ok) => {
    if (pc.iceGatheringState === "complete") return ok();
    const t = setTimeout(ok, ICE_GATHER_MS);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); ok(); } });
  });
}

/** Почати публікацію. url — /live/whip/<id>/whip, key — ключ трансляції з кабінету. */
export async function publish(stream: MediaStream, url: string, key: string): Promise<WhipSession> {
  const pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
  let video: RTCRtpSender | null = null, audio: RTCRtpSender | null = null;
  const v = stream.getVideoTracks()[0], a = stream.getAudioTracks()[0];
  // трансівери є завжди: мікрофон можна вимкнути й увімкнути без нового підключення (replaceTrack)
  const vt = pc.addTransceiver(v ?? "video", { direction: "sendonly", streams: [stream] });
  preferH264(vt); video = vt.sender;
  const at = pc.addTransceiver(a ?? "audio", { direction: "sendonly", streams: [stream] });
  audio = at.sender;

  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${key}` }, body: pc.localDescription!.sdp });
    if (r.status === 401 || r.status === 403) throw new WhipError("Сервер не прийняв ключ трансляції — оновіть сторінку", r.status);
    if (!r.ok) throw new WhipError(`Сервер трансляцій відповів ${r.status}`, r.status);
    const location = r.headers.get("Location");
    await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
    await capBitrate(video);
    const stop = async () => {
      pc.close();
      // сесію на сервері закриваємо явно, інакше потік «висить» до тайм-ауту ICE
      if (location) await fetch(new URL(location, new URL(url, window.location.href)), { method: "DELETE", headers: { Authorization: `Bearer ${key}` } }).catch(() => {});
    };
    return { pc, video, audio, stop };
  } catch (e) { pc.close(); throw e; }
}

async function capBitrate(s: RTCRtpSender | null) {
  if (!s) return;
  const p = s.getParameters();
  if (!p.encodings?.length) p.encodings = [{}];
  p.encodings[0]!.maxBitrate = MAX_BITRATE;
  await s.setParameters(p).catch(() => {});
}
