import { useCallback, useEffect, useState } from "react";
import { Redirect, Route, Switch, useLocation, useParams } from "wouter";
import { api, ApiError, type Me, type Org } from "./api.ts";
import { Layout } from "./components/Layout.tsx";
import { Login } from "./pages/Login.tsx";
import { Invite, NewOrg } from "./pages/Orgs.tsx";
import { Devices } from "./pages/Devices.tsx";
import { DeviceDetail } from "./pages/DeviceDetail.tsx";
import { Screens } from "./pages/Screens.tsx";
import { ScreenEditor } from "./pages/ScreenEditor.tsx";
import { Members, Settings } from "./pages/Members.tsx";
import { Landing } from "./pages/Landing.tsx";
import { Admin } from "./pages/Admin.tsx";
import { flushPending, pageView } from "./analytics.ts";
import { isPublicPath, titleFor } from "./seo.ts";
import { CONTENT, langOfPath } from "./landing/content.ts";

const LAST_ORG = "deye.lastOrg";

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = ще не знаємо
  const [loc, navigate] = useLocation();
  const reload = useCallback(async () => {
    try { setMe(await api.get<Me>("/api/me")); }
    catch (e) { if (e instanceof ApiError && e.status === 401) setMe(null); else throw e; }
  }, []);
  useEffect(() => { void reload(); flushPending(); }, [reload]);
  // SEO/аналітика: заголовок, noindex для кабінету, page_view при зміні маршруту
  useEffect(() => {
    document.title = titleFor(loc);
    document.documentElement.lang = isPublicPath(loc) ? CONTENT[langOfPath(loc)].htmlLang : "uk";
    let m = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!m) { m = document.createElement("meta"); m.name = "robots"; document.head.appendChild(m); }
    m.content = isPublicPath(loc) ? "index, follow" : "noindex, nofollow";
    pageView(loc);
  }, [loc]);

  // лендінг не чекає /api/me: пререндерена розмітка гідрується одразу, кнопка «Кабінет» зʼявиться після відповіді
  if (isPublicPath(loc)) return <Landing me={me ?? null} lang={langOfPath(loc)} />;
  if (me === undefined) return <div className="auth"><p className="muted">Завантаження…</p></div>;
  const isAuthPage = loc.startsWith("/login") || loc.startsWith("/signup");
  if (!me) {
    if (isAuthPage) return <Switch><Route path="/login"><Login mode="login" /></Route><Route path="/signup"><Login mode="signup" /></Route></Switch>;
    return <Redirect to={`/login?next=${encodeURIComponent(loc)}`} />;
  }
  if (isAuthPage) return <Redirect to="/app" />;

  return <Switch>
    <Route path="/invite/:token">{(p) => <Invite token={p.token!} onAccepted={reload} />}</Route>
    <Route path="/new-org"><NewOrg me={me} onCreated={reload} /></Route>
    <Route path="/admin"><Admin me={me} /></Route>
    <Route path="/app/billing/:orgId">{(p) => <Redirect to={`/o/${p.orgId}/settings${location.search}`} />}</Route>
    <Route path="/o/:orgId/*?">{(p) => <OrgArea me={me} orgId={p.orgId!} />}</Route>
    <Route path="/app">{() => {
      const last = localStorage.getItem(LAST_ORG);
      const org = me.orgs.find((o) => o.id === last) ?? me.orgs[0];
      return org ? <Redirect to={`/o/${org.id}/devices`} /> : <NewOrg me={me} onCreated={reload} />;
    }}</Route>
  </Switch>;
}

function OrgArea({ me, orgId }: { me: Me; orgId: string }) {
  const [org, setOrg] = useState<Org | null>(null);
  useEffect(() => { localStorage.setItem(LAST_ORG, orgId); void api.get<Org>(`/api/orgs/${orgId}`).then(setOrg).catch(() => setOrg(null)); }, [orgId]);
  if (!me.orgs.some((o) => o.id === orgId)) return <Redirect to="/" />;
  return <Layout me={me} orgId={orgId}>
    {!org ? <p className="muted">Завантаження…</p> : <Switch>
      <Route path="/o/:orgId/devices"><Devices org={org} /></Route>
      <Route path="/o/:orgId/devices/:deviceId">{(p) => <DeviceDetail org={org} deviceId={p.deviceId!} />}</Route>
      <Route path="/o/:orgId/screens"><Screens org={org} /></Route>
      <Route path="/o/:orgId/screens/:screenId">{(p) => <ScreenEditor org={org} screenId={p.screenId!} />}</Route>
      <Route path="/o/:orgId/members"><Members org={org} meId={me.user.id} /></Route>
      <Route path="/o/:orgId/settings"><Settings org={org} onPlanChange={() => void api.get<Org>(`/api/orgs/${orgId}`).then(setOrg)} /></Route>
      <Route><Redirect to={`/o/${orgId}/devices`} /></Route>
    </Switch>}
  </Layout>;
}
void useParams;
