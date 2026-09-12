import { useEffect, useState } from "react";
import { orgRoles, type OrgRole } from "@deye/shared";
import { api, type Invite, type Member, type Org } from "../api.ts";
import { Btn, Card, ErrorBox, fmtDate, useAction } from "../components/ui.tsx";

const ROLE: Record<OrgRole, string> = { owner: "власник", admin: "адмін", staff: "персонал" };

export function Members({ org, meId }: { org: Org; meId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [role, setRole] = useState<OrgRole>("staff");
  const isOwner = org.role === "owner", isAdmin = org.role !== "staff";
  const load = async () => { setMembers(await api.get(`/api/orgs/${org.id}/members`)); if (isAdmin) setInvites(await api.get(`/api/orgs/${org.id}/invites`)); };
  useEffect(() => { void load(); }, [org.id]);

  const invite = useAction(async () => { const r = await api.post<{ url: string }>(`/api/orgs/${org.id}/invites`, { role }); setLink(r.url); await load(); });
  const revoke = useAction(async (id: string) => { await api.del(`/api/orgs/${org.id}/invites/${id}`); await load(); });
  const remove = useAction(async (m: Member) => { if (confirm(`Прибрати ${m.email}?`)) { await api.del(`/api/orgs/${org.id}/members/${m.userId}`); await load(); } });
  const change = useAction(async ({ m, r }: { m: Member; r: OrgRole }) => { await api.patch(`/api/orgs/${org.id}/members/${m.userId}`, { role: r }); await load(); });

  return <>
    <Card title="Учасники">
      <ErrorBox err={remove.err ?? change.err} />
      <table className="tbl"><thead><tr><th>Email</th><th>Імʼя</th><th>Роль</th><th>З</th><th></th></tr></thead><tbody>
        {members.map((m) => <tr key={m.userId}>
          <td>{m.email}{m.userId === meId && <span className="muted"> (ви)</span>}</td><td>{m.name}</td>
          <td>{isOwner ? <select value={m.role} onChange={(e) => change.run({ m, r: e.currentTarget.value as OrgRole })}>{orgRoles.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</select> : ROLE[m.role]}</td>
          <td className="muted small">{fmtDate(m.since)}</td>
          <td className="actions">{isOwner && <Btn kind="ghost" onClick={() => remove.run(m)}>Прибрати</Btn>}</td>
        </tr>)}
      </tbody></table>
    </Card>
    {isAdmin && <Card title="Запросити">
      <p className="muted small">Одноразове посилання, діє 72 години. Перегляд екрана прав не дає, а запрошення екран не показує.</p>
      <div className="row">
        <select value={role} onChange={(e) => setRole(e.currentTarget.value as OrgRole)}>
          <option value="staff">персонал</option><option value="admin">адмін</option>{isOwner && <option value="owner">власник</option>}
        </select>
        <Btn kind="primary" onClick={() => invite.run(undefined)} disabled={invite.busy}>Створити посилання</Btn>
      </div>
      <ErrorBox err={invite.err ?? revoke.err} />
      {link && <div className="ok"><code className="wrap">{link}</code><Btn kind="ghost" onClick={() => navigator.clipboard?.writeText(link)}>Копіювати</Btn></div>}
      {invites.filter((i) => !i.usedAt).length > 0 && <table className="tbl small"><thead><tr><th>Роль</th><th>Діє до</th><th></th></tr></thead><tbody>
        {invites.filter((i) => !i.usedAt).map((i) => <tr key={i.id}><td>{ROLE[i.role]}</td><td>{fmtDate(i.expiresAt)}</td><td className="actions"><Btn kind="ghost" onClick={() => revoke.run(i.id)}>Відкликати</Btn></td></tr>)}
      </tbody></table>}
    </Card>}
  </>;
}

export function Settings({ org }: { org: Org }) {
  const L = org.plan.limits;
  return <Card title="Організація">
    <p><b>{org.name}</b></p>
    <p>Тариф: <b>{org.plan.name}</b></p>
    <ul className="muted">
      <li>Екранів: {L.screens}</li><li>Власні фони: {L.custom_backgrounds ? "так" : "ні"}</li>
      <li>Історія: {L.history_days ? `${L.history_days} днів` : "ні"}</li><li>Радіо: {L.radio ? "так" : "ні"}</li>
      <li>Брендинг на екрані: {L.branding ? "так" : "ні"}</li>
    </ul>
  </Card>;
}
