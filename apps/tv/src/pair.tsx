/**
 * /tv — введення 6-значного коду з кабінету пультом ТБ.
 * Після успіху токен зберігається в localStorage: наступного разу /tv одразу відкриє екран.
 */
import { useEffect, useRef, useState } from "preact/hooks";

export const TOKEN_KEY = "deye.tv.token";
export function savedToken(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
export function saveToken(t: string) { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* приватний режим */ } }
export function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }

export function Pair() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const submit = async () => {
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6 || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/public/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: clean }) });
      if (r.status === 404) { setErr("Код не знайдено або прострочений. Створіть новий у кабінеті."); setCode(""); return; }
      if (r.status === 429) { setErr("Забагато спроб, зачекайте хвилину."); return; }
      if (!r.ok) { setErr(`Помилка ${r.status}`); return; }
      const { token } = (await r.json()) as { token: string };
      saveToken(token);
      location.replace(`/s/${token}`);
    } catch { setErr("Немає звʼязку з сервером"); }
    finally { setBusy(false); input.current?.focus(); }
  };

  return <div class="pair">
    <div class="pair-box">
      <div class="pair-title">☀ Deye Dashboard</div>
      <div class="pair-hint">У кабінеті відкрийте екран → «Код для ТБ» і введіть 6 цифр</div>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <input ref={input} class="pair-input" type="tel" inputMode="numeric" pattern="[0-9 ]*" maxLength={7} placeholder="000000"
          value={code} onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value.replace(/[^\d]/g, "").slice(0, 6))} autoFocus />
        <button class="pair-btn" type="submit" disabled={busy || code.replace(/\D/g, "").length !== 6}>{busy ? "…" : "Відкрити"}</button>
      </form>
      {err && <div class="pair-err">{err}</div>}
      <div class="pair-foot">tv.sun-hunter.men/tv</div>
    </div>
  </div>;
}
