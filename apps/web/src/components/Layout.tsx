/** Каркас кабінету: на десктопі бокова панель (бренд, заклад, навігація, користувач), на мобільному — шапка з табами. */
import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";
import type { Me } from "../api.ts";
import { authClient } from "../auth.ts";
import { PRODUCT_NAME } from "@deye/shared";
import { Logo } from "./Logo.tsx";
import { Icon, type IconName } from "./Icon.tsx";

const ROLE: Record<string, string> = { owner: "власник", admin: "адмін", staff: "персонал" };
const NAV: [string, string, IconName][] = [["devices", "Пристрої", "devices"], ["screens", "Екрани", "screens"], ["members", "Учасники", "members"], ["settings", "Налаштування", "settings"]];

export function Layout({ me, orgId, children }: { me: Me; orgId: string; children: ReactNode }) {
  const [loc, navigate] = useLocation();
  const org = me.orgs.find((o) => o.id === orgId);
  const signOut = async () => { await authClient.signOut(); location.href = "/"; };
  return <div className="layout with-side">
    <div className="app-bg" aria-hidden="true" />
    <header className="top">
      <div className="top-row">
        <Link href="/" className="brand" title="На головну"><Logo />{PRODUCT_NAME}</Link>
        <select className="orgsel" value={orgId} onChange={(e) => { const v = e.currentTarget.value; navigate(v === "__new" ? "/new-org" : `/o/${v}/devices`); }}>
          {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value="__new">+ Нова організація…</option>
        </select>
        <div className="grow" />
        {org && <Link href={`/o/${orgId}/settings`} className={`plan-chip plan-${org.planId}`} title="Тариф закладу">{org.planId}</Link>}
        <span className="user" title={me.user.email}><span className="avatar">{(me.user.name || me.user.email).slice(0, 1).toUpperCase()}</span><span className="user-t"><b>{me.user.name || me.user.email.split("@")[0]}</b><small>{org ? ROLE[org.role] ?? org.role : me.user.email}</small></span></span>
        <button className="btn btn-ghost logout" onClick={signOut} title="Вийти"><Icon name="logout" /><span>Вийти</span></button>
      </div>
      <nav className="top-nav">
        {NAV.map(([path, label, icon]) => { const href = `/o/${orgId}/${path}`; return <Link key={path} href={href} className={loc.startsWith(href) ? "tab on" : "tab"}><Icon name={icon} />{label}</Link>; })}
        {me.user.isSuperadmin && <Link href="/admin" className="tab"><Icon name="admin" />Адмін</Link>}
      </nav>
    </header>
    <main className="content">{children}</main>
  </div>;
}
