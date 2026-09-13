import { Link, useLocation } from "wouter";
import type { ReactNode } from "react";
import type { Me } from "../api.ts";
import { authClient } from "../auth.ts";
import { PRODUCT_NAME } from "@deye/shared";

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
        <div className="brand">☀ {PRODUCT_NAME}</div>
        <select className="orgsel" value={orgId} onChange={(e) => { const v = e.currentTarget.value; navigate(v === "__new" ? "/new-org" : `/o/${v}/devices`); }}>
          {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          <option value="__new">+ Нова організація…</option>
        </select>
        <div className="grow" />
        {me.user.isSuperadmin && <Link href="/admin" className="tab hide-m">Адмін</Link>}
        <span className="muted hide-m">{me.user.email}{org ? ` · ${org.role}` : ""}</span>
        <button className="btn btn-ghost" onClick={async () => { await authClient.signOut(); location.href = "/login"; }} title="Вийти">Вийти</button>
      </div>
      <nav className="top-nav">{tab("devices", "Пристрої")}{tab("screens", "Екрани")}{tab("members", "Учасники")}{tab("settings", "Налаштування")}{me.user.isSuperadmin && <Link href="/admin" className="tab show-m">Адмін</Link>}</nav>
    </header>
    <main className="content">{children}</main>
  </div>;
}
