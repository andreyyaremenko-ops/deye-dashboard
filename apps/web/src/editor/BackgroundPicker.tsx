import { useRef, useState } from "react";
import { api, uploadBackground, type Background, type Org } from "../api.ts";
import { Btn, ErrorBox, useAction } from "../components/ui.tsx";
import type { Backgrounds } from "./useBackgrounds.ts";

const STATUS: Record<Background["status"], string> = { uploaded: "у черзі", processing: "обробка…", ready: "", failed: "помилка" };

export function BackgroundPicker({ org, bgs, value, onChange, canEdit }: { org: Org; bgs: Backgrounds; value: string | null; onChange: (id: string | null) => void; canEdit: boolean }) {
  const { list, reload: load } = bgs;
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = useAction(async (file: File) => {
    setProgress(0);
    try { await uploadBackground(org.id, file, setProgress); await load(); } finally { setProgress(null); if (fileRef.current) fileRef.current.value = ""; }
  });
  const del = useAction(async (b: Background) => {
    if (!confirm(`Видалити фон «${b.name}»?`)) return;
    await api.del(`/api/orgs/${org.id}/backgrounds/${b.id}`);
    if (value === b.id) onChange(null);
    await load();
  });
  const allowUpload = org.plan.limits.custom_backgrounds;
  const groups = new Map<string, Background[]>();
  for (const b of list) { const k = b.orgId ? "Мої" : (b.category ?? "Інше"); groups.set(k, [...(groups.get(k) ?? []), b]); }

  return <div className="bgp">
    <div className="bgp-grid">
      <button className={`bgp-item${value === null ? " sel" : ""}`} onClick={() => onChange(null)} disabled={!canEdit}><div className="bgp-thumb bgp-none" /><span>Без фону</span></button>
      {[...groups.entries()].map(([cat, items]) => <div key={cat} className="bgp-group"><div className="bgp-cat">{cat}</div>
        {items.map((b) => <div key={b.id} className={`bgp-item${value === b.id ? " sel" : ""}${b.status !== "ready" ? " dim" : ""}`}
          onClick={() => canEdit && b.status === "ready" && onChange(b.id)} title={b.attribution ?? ""}>
          <div className="bgp-thumb" style={b.preview ? { backgroundImage: `url(/media/${b.preview})` } : undefined}>{b.status !== "ready" && <em>{STATUS[b.status]}</em>}</div>
          <span>{b.name}{b.kind === "image" ? <i className="muted"> · фото</i> : b.durationS ? <i className="muted"> · {b.durationS}с</i> : null}</span>
          {b.orgId && canEdit && <button className="bgp-del" onClick={(e) => { e.stopPropagation(); void del.run(b); }} title="Видалити">×</button>}
        </div>)}
      </div>)}
    </div>
    {canEdit && <div className="bgp-upload">
      <input ref={fileRef} type="file" accept="video/*,image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void upload.run(f); }} />
      <Btn onClick={() => fileRef.current?.click()} disabled={!allowUpload || progress !== null}>{progress !== null ? `Завантаження ${progress}%` : "Завантажити відео або фото"}</Btn>
      <span className="muted small">{allowUpload ? "Відео mp4/mov до 300 MB і 90 с або фото jpg/png/webp до 30 MB, горизонтальні. Після обробки зʼявиться в «Мої»." : "Власні фони доступні в тарифі Pro."}</span>
    </div>}
    <ErrorBox err={upload.err ?? del.err} />
  </div>;
}
