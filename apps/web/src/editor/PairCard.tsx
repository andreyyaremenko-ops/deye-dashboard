/** Підключення телевізора: 6-значний код (15 хв) або повне посилання з view-токеном. */
import { useEffect, useState } from "react";
import { api, screenUrl, type Org, type Screen } from "../api.ts";
import { Btn, Card, ErrorBox, useAction } from "../components/ui.tsx";

export function PairCard({ org, screen, canEdit }: { org: Org; screen: Screen; canEdit: boolean }) {
  const [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!pair) return;
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(pair.expiresAt) - Date.now()) / 1000)));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [pair]);
  const issue = useAction(async () => { setPair(await api.post(`/api/orgs/${org.id}/screens/${screen.id}/pair-code`)); });
  const url = screenUrl(screen.viewToken);
  return <Card title="Підключити телевізор">
    <p className="small">На телевізорі відкрийте <b>{location.host}/tv</b> і введіть код:</p>
    {pair && left > 0
      ? <div className="paircode"><b>{pair.code.slice(0, 3)} {pair.code.slice(3)}</b><span className="muted small">діє ще {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span></div>
      : <Btn kind="primary" onClick={() => issue.run(undefined)} disabled={!canEdit || issue.busy}>Код для ТБ</Btn>}
    <ErrorBox err={issue.err} />
    <p className="muted small">Після введення ТБ запамʼятає екран. Повне посилання, якщо зручніше:</p>
    <code className="small wrap">{url}</code>
    <p className="muted small">Лише перегляд. Не дає доступу до кабінету.</p>
  </Card>;
}
