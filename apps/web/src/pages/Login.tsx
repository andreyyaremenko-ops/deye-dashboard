import { useState } from "react";
import { Link } from "wouter";
import { authClient } from "../auth.ts";
import { Btn, ErrorBox, Field, onSubmit, useAction } from "../components/ui.tsx";
import { PRODUCT_NAME } from "@deye/shared";

export function Login({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [sent, setSent] = useState(false);
  const next = new URLSearchParams(location.search).get("next") ?? "/app";

  const pw = useAction(async () => {
    const r = mode === "login"
      ? await authClient.signIn.email({ email, password })
      : await authClient.signUp.email({ email, password, name: name || email.split("@")[0]! });
    if (r.error) throw new Error(r.error.message ?? "Помилка входу");
    location.assign(next); // повне перезавантаження: App перечитає /api/me
  });
  const magic = useAction(async () => {
    if (!email) throw new Error("Введіть email");
    const r = await authClient.signIn.magicLink({ email, callbackURL: next });
    if (r.error) throw new Error(r.error.message ?? "Не вдалося надіслати лист");
    setSent(true);
  });
  const google = () => authClient.signIn.social({ provider: "google", callbackURL: next });

  return <div className="auth">
    <div className="auth-box">
      <h1>☀ {PRODUCT_NAME}</h1>
      <p className="muted">{mode === "login" ? "Вхід у кабінет" : "Реєстрація"}</p>
      <form onSubmit={onSubmit(() => pw.run(undefined))}>
        {mode === "signup" && <Field label="Імʼя"><input value={name} onChange={(e) => setName(e.currentTarget.value)} /></Field>}
        <Field label="Email"><input type="email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} autoComplete="email" /></Field>
        <Field label="Пароль"><input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} /></Field>
        <ErrorBox err={pw.err} />
        <Btn type="submit" kind="primary" disabled={pw.busy}>{mode === "login" ? "Увійти" : "Зареєструватися"}</Btn>
      </form>
      <div className="or">або</div>
      <Btn onClick={google}>Увійти через Google</Btn>
      <Btn onClick={() => magic.run(undefined)} disabled={magic.busy}>Надіслати посилання для входу на email</Btn>
      {sent && <div className="ok">Лист надіслано. Перевірте пошту, посилання діє 15 хвилин.</div>}
      <ErrorBox err={magic.err} />
      <p className="muted small">
        {mode === "login" ? <>Немає акаунта? <Link href="/signup">Зареєструватися</Link></> : <>Уже є акаунт? <Link href="/login">Увійти</Link></>}
      </p>
    </div>
  </div>;
}
