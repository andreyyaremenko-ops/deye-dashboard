import { describe, it, expect, vi } from "vitest";
import { GrokProvider, outputText, costMicrosOf } from "../src/ai/grok.ts";
import { providersFromEnv } from "../src/ai/index.ts";
import { runMenuImport, type AiJobRow } from "../src/menu-import.ts";

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const MENU_JSON = JSON.stringify({ sections: [{ name: "Кава", items: [{ name: "Лате", price: "70", volume: "0,25 л", confidence: 0.95 }] }] });
const RESPONSE = {
  output: [{ content: [{ type: "reasoning", text: "думаю" }, { type: "output_text", text: MENU_JSON }] }],
  usage: { input_tokens: 1200, output_tokens: 300, cost_in_usd_ticks: 37_756_000 },   // $0.0037756
};

describe("відповідь xAI", () => {
  it("бере лише output_text, вартість у мікродоларах", () => {
    expect(outputText(RESPONSE)).toBe(MENU_JSON);
    expect(outputText({})).toBe("");
    expect(costMicrosOf(RESPONSE.usage)).toBe(3776);      // 0.0037756 $ -> 3775.6 мкд
    expect(costMicrosOf(undefined)).toBe(0);
  });

  it("readMenu шле фото як data-URL і повертає облік", async () => {
    const fetchImpl = vi.fn(async () => okJson(RESPONSE)) as unknown as typeof fetch;
    const p = new GrokProvider({ apiKey: "k", fetchImpl, visionModel: "grok-4.7" });
    const r = await p.readMenu([{ data: Buffer.from("photo"), mime: "image/jpeg" }], { system: "S", user: "U" });
    expect(r.raw).toBe(MENU_JSON);
    expect(r.usage).toEqual({ provider: "xai", model: "grok-4.7", tokensIn: 1200, tokensOut: 300, images: 0, costMicros: 3776 });
    const body = JSON.parse((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1].body);
    expect(body.model).toBe("grok-4.7");
    expect(body.input[0].content[0]).toEqual({ type: "input_image", image_url: `data:image/jpeg;base64,${Buffer.from("photo").toString("base64")}` });
    expect(body.input[0].content[1].text).toContain("S");
  });

  it("повторює 429 і здається на 400", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => (++calls < 2 ? new Response("slow down", { status: 429 }) : okJson(RESPONSE))) as unknown as typeof fetch;
    const p = new GrokProvider({ apiKey: "k", fetchImpl, retries: 2, timeoutMs: 1000 });
    // затримка між спробами — 1 с; для тесту достатньо, що виклик врешті вдався
    await expect(p.readMenu([{ data: Buffer.from("x"), mime: "image/png" }], { system: "s", user: "u" })).resolves.toBeTruthy();
    expect(calls).toBe(2);

    const bad = vi.fn(async () => new Response("bad request", { status: 400 })) as unknown as typeof fetch;
    const p2 = new GrokProvider({ apiKey: "k", fetchImpl: bad, retries: 2 });
    await expect(p2.generate("торт", 2)).rejects.toThrow(/xai 400/);
    expect((bad as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  }, 10_000);

  it("generate повертає буфери зображень", async () => {
    const png = Buffer.from("fake-png");
    const fetchImpl = vi.fn(async () => okJson({
      data: [{ b64_json: png.toString("base64"), mime_type: "image/png" }, { b64_json: png.toString("base64") }],
      usage: { cost_in_usd_ticks: 400_000_000 },
    })) as unknown as typeof fetch;
    const p = new GrokProvider({ apiKey: "k", fetchImpl, imageModel: "grok-imagine-image-2.0" });
    const r = await p.generate("страва", 2);
    expect(r.images).toHaveLength(2);
    expect(r.images[0]!.data.equals(png)).toBe(true);
    expect(r.usage).toMatchObject({ images: 2, costMicros: 40_000, model: "grok-imagine-image-2.0" });
  });

  it("без ключа провайдерів немає — черга AI просто стоїть", () => {
    expect(providersFromEnv({} as NodeJS.ProcessEnv)).toEqual({ vision: null, image: null });
    expect(providersFromEnv({ XAI_API_KEY: "k" } as NodeJS.ProcessEnv).vision).toBeTruthy();
  });
});

/** Підробка postgres-js: записує запити, віддає передбачені рядки. */
function fakeSql(rows: Record<string, unknown[]> = {}) {
  const queries: string[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(q);
    const key = Object.keys(rows).find((k) => q.includes(k));
    return Promise.resolve(key ? rows[key]! : []);
  };
  const sql = Object.assign(run, {
    begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(sql),
    json: (o: unknown) => o,
    queries,
    values: [] as unknown[],
  });
  return sql;
}

describe("задача menu_import", () => {
  const job: AiJobRow = { id: "job-1", org_id: "org-1", kind: "menu_import", ref_id: "menu-1", payload: { files: ["menu-import/a/1.jpg"] } };
  const vision = {
    readMenu: async () => ({ raw: MENU_JSON, usage: { provider: "xai", model: "grok-4.7", tokensIn: 10, tokensOut: 5, images: 0, costMicros: 42 } }),
  };

  it("створює розділи й позиції, переводить меню в чернетку і пише облік", async () => {
    const dir = await import("node:fs/promises");
    const tmp = await dir.mkdtemp("/tmp/menu-import-");
    await dir.mkdir(`${tmp}/menu-import/a`, { recursive: true });
    await dir.writeFile(`${tmp}/menu-import/a/1.jpg`, "photo");

    const sql = fakeSql({ "insert into menu_sections": [{ id: "sec-1" }], "coalesce(max(sort)": [{ next: 0 }] });
    const res = await runMenuImport(sql as never, job, vision as never, tmp);
    expect(res).toMatchObject({ sections: 1, items: 1, costMicros: 42 });
    const q = sql.queries.join("\n");
    expect(q).toContain("insert into menu_sections");
    expect(q).toContain("insert into menu_items");
    expect(q).toContain("update menus set status = 'draft'");
    expect(q).toContain("insert into ai_usage");
    await dir.rm(tmp, { recursive: true, force: true });
  });

  it("без файлів — помилка задачі", async () => {
    await expect(runMenuImport(fakeSql() as never, { ...job, payload: {} }, vision as never, "/tmp")).rejects.toThrow(/без файлів/);
  });
});

describe("задача dish_image", () => {
  const job = { id: "job-2", org_id: "org-1", kind: "dish_image" as const, ref_id: "item-1", payload: { n: 2 } };

  it("будує промпт зі стилю закладу, зберігає варіанти і перше робить обраним", async () => {
    const { runDishImage } = await import("../src/dish-image.ts");
    const fs = await import("node:fs/promises");
    const tmp = await fs.mkdtemp("/tmp/dish-");
    // 1x1 jpeg, щоб ffmpeg мав що обробляти
    const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
    const image = { generate: async (prompt: string, n: number) => ({
      images: Array.from({ length: n }, () => ({ data: jpeg, mime: "image/jpeg" })),
      usage: { provider: "xai", model: "grok-imagine-image-2.0", tokensIn: 0, tokensOut: 0, images: n, costMicros: 80_000 },
      prompt,
    }) };
    const seen: string[] = [];
    const sql = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.join("?").replace(/\s+/g, " ").trim();
      seen.push(q);
      if (q.startsWith("select i.id")) return Promise.resolve([{ id: "item-1", name: "Борщ", description: "зі сметаною", menu_id: "m1", org_id: "org-1", prompt: "Стиль закладу", bg_mode: "solid", bg_color: "#ffffff" }]);
      if (q.includes("insert into dish_images")) return Promise.resolve([{ id: `img-${values[0]}` }]);
      return Promise.resolve([]);
    }, { begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(sql), json: (o: unknown) => o });

    const res = await runDishImage(sql as never, job, image as never, tmp);
    expect(res).toMatchObject({ variants: 2, costMicros: 80_000 });
    const q = seen.join("\n");
    expect(q).toContain("insert into dish_images");
    expect(q).toContain("insert into ai_usage");
    expect(q).toContain("image_is_ai = true");
    expect(q).toContain("image_id is null");      // не перебиваємо вже обране фото
    await fs.rm(tmp, { recursive: true, force: true });
  }, 20_000);

  it("страву видалили, поки задача чекала — зрозуміла помилка", async () => {
    const { runDishImage } = await import("../src/dish-image.ts");
    const sql = Object.assign(() => Promise.resolve([]), { begin: async (f: (t: unknown) => Promise<unknown>) => f(null), json: (o: unknown) => o });
    await expect(runDishImage(sql as never, job, {} as never, "/tmp")).rejects.toThrow(/видалено/);
  });
});
