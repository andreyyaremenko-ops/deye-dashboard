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
      <div className="brand">☀ {PRODUCT_NAME}</div>
      <select className="orgsel" value={orgId} onChange={(e) => { const v = e.currentTarget.value; navigate(v === "__new" ? "/new-org" : `/o/${v}/devices`); }}>
        {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        <option value="__new">+ Нова організація…</option>
      </select>
      <nav>{tab("devices", "Пристрої")}{tab("screens", "Екрани")}{tab("members", "Учасники")}{tab("settings", "Налаштування")}</nav>
      <div className="grow" />
      <span className="muted">{me.user.email}{org ? ` · ${org.role}` : ""}</span>
      <button className="btn btn-ghost" onClick={async () => { await authClient.signOut(); location.href = "/login"; }}>Вийти</button>
    </header>
    <main className="content">{children}</main>
  </div>;
}
