/** Фони організації: спільний список для пульта (мініатюра), галереї й полотна; поки щось обробляється — опитуємо. */
import { useCallback, useEffect, useState } from "react";
import { api, type Background } from "../api.ts";

export interface Backgrounds { list: Background[]; reload: () => Promise<void> }

export function useBackgrounds(orgId: string): Backgrounds {
  const [list, setList] = useState<Background[]>([]);
  const reload = useCallback(async () => setList(await api.get<Background[]>(`/api/orgs/${orgId}/backgrounds`)), [orgId]);
  useEffect(() => { void reload(); }, [reload]);
  const pending = list.some((b) => b.status === "uploaded" || b.status === "processing");
  useEffect(() => { if (!pending) return; const t = setInterval(() => void reload(), 5000); return () => clearInterval(t); }, [pending, reload]);
  return { list, reload };
}

export const bgPreview = (b: Background | undefined) => (b?.preview ? `/media/${b.preview}` : null);
