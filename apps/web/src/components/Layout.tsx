import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";
import type { Me } from "../api.ts";
import { authClient } from "../auth.ts";
import { PRODUCT_NAME } from "@deye/shared";

const ROLE: Record<string, string> = { owner: "власник", admin: "адмін", staff: "персонал" };
/** Знак сонця в шапці й на сторінці входу. */
export function Logo() {
  return <svg className="logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
  </svg>;
}

export function Layout({ me, orgId, children }: { me: Me; orgId: string; children: ReactNode }) {
  const [loc, navigate] = useLocation();
  const org = me.orgs.find((o) => o.id === orgId);
  const tab = (path: string, label: string) => {
    const href = `/o/${orgId}/${path}`;
    return <Link href={href} className={loc.startsWith(href) ? "tab on" : "tab"}>{label}</Link>;
  };
  return <div className="layout">
    <header className="top">
      <div className="top-row">
        <Link href="/" className="brand" title="На головну"><Logo />{PRODUCT_NAME}</Link>
        <select className="orgsel" value={orgId} onChange={(e) => { const v = e.currentTarget.value; navigate(v === "__new" ? "/new-org" : `/o/${v}/devices`); }}>
          {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value="__new">+ Нова організація…</option>
        </select>
        <div className="grow" />
        {me.user.isSuperadmin && <Link href="/admin" className="tab hide-m">Адмін</Link>}
        <span className="user hide-m" title={me.user.email}><span className="avatar">{(me.user.name || me.user.email).slice(0, 1).toUpperCase()}</span>{me.user.email}{org ? ` · ${ROLE[org.role] ?? org.role}` : ""}</span>
        <button className="btn btn-ghost" onClick={async () => { await authClient.signOut(); location.href = "/"; }} title="Вийти">Вийти</button>
      </div>
      <nav className="top-nav">{tab("devices", "Пристрої")}{tab("screens", "Екрани")}{tab("members", "Учасники")}{tab("settings", "Налаштування")}{me.user.isSuperadmin && <Link href="/admin" className="tab show-m">Адмін</Link>}</nav>
    </header>
    <main className="content">{children}</main>
  </div>;
}
