/** Галерея фонів у вікні: вибір одразу ставить фон поточній сцені або всім сценам. */
import { useEffect, useRef, useState } from "react";
import type { Org } from "../api.ts";
import { BackgroundPicker } from "./BackgroundPicker.tsx";
import type { Backgrounds } from "./useBackgrounds.ts";

export function BackgroundDialog({ org, bgs, value, sceneName, many, canEdit, onPick, onClose }: {
  org: Org; bgs: Backgrounds; value: string | null; sceneName: string; many: boolean; canEdit: boolean;
  onPick: (id: string | null, allScenes: boolean) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="dlg bg-dialog" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}>
    <div className="dlg-h">
      <h2>Фон {all ? "усіх сцен" : `сцени «${sceneName}»`}</h2>
      <div className="grow" />
      {many && <label className="check small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.currentTarget.checked)} /> для всіх сцен</label>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => ref.current?.close()} aria-label="Закрити">✕</button>
    </div>
    <BackgroundPicker org={org} bgs={bgs} value={value} canEdit={canEdit} onChange={(id) => { onPick(id, all); ref.current?.close(); }} />
  </dialog>;
}
