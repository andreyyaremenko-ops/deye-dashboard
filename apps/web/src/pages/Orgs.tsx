import { useState } from "react";
import { useLocation } from "wouter";
import { api, type Me, type OrgSummary } from "../api.ts";
import { Btn, ErrorBox, Field, onSubmit, useAction } from "../components/ui.tsx";

export function NewOrg({ me, onCreated }: { me: Me; onCreated: () => Promise<void> }) {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const a = useAction(async () => {
    const org = await api.post<OrgSummary>("/api/orgs", { name });
    await onCreated();
    navigate(`/o/${org.id}/devices`);
  });
  return <div className="auth"><div className="auth-box">
    <h1>{me.orgs.length ? "Нова організація" : "Вітаємо!"}</h1>
    <p className="muted">Організація — це заклад: у ній пристрої, екрани й учасники.</p>
    <form onSubmit={onSubmit(() => a.run(undefined))}>
      <Field label="Назва закладу"><input required value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Кафе «Сонце»" /></Field>
      <ErrorBox err={a.err} />
      <Btn type="submit" kind="primary" disabled={a.busy}>Створити</Btn>
    </form>
  </div></div>;
}

export function Invite({ token, onAccepted }: { token: string; onAccepted: () => Promise<void> }) {
  const [, navigate] = useLocation();
  const a = useAction(async () => {
    const r = await api.post<{ orgId: string; role: string }>(`/api/invites/${token}/accept`);
    await onAccepted();
    navigate(`/o/${r.orgId}/devices`);
  });
  return <div className="auth"><div className="auth-box">
    <h1>Запрошення в організацію</h1>
    <p className="muted">Прийняти запрошення цим акаунтом?</p>
    <ErrorBox err={a.err} />
    <Btn kind="primary" onClick={() => a.run(undefined)} disabled={a.busy}>Прийняти</Btn>
  </div></div>;
}
