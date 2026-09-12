export class HttpError extends Error {
  statusCode: number;
  code: string | undefined;
  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
export const notFound = (m = "Not found") => new HttpError(404, m, "not_found");
export const forbidden = (m = "Forbidden") => new HttpError(403, m, "forbidden");
export const unauthorized = (m = "Unauthorized") => new HttpError(401, m, "unauthorized");
export const conflict = (m: string, code = "conflict") => new HttpError(409, m, code);
export const badRequest = (m: string, code = "bad_request") => new HttpError(400, m, code);

/** Postgres 23505 (unique_violation), опційно за імʼям індексу. Drizzle загортає причину в cause. */
export function isUniqueViolation(e: unknown, index?: string): boolean {
  let cur: any = e;
  for (let i = 0; i < 4 && cur; i++) {
    const msg = String(cur.message ?? cur);
    if (cur.code === "23505" || msg.includes("duplicate key")) return !index || msg.includes(index) || String(cur.constraint_name ?? cur.constraint ?? "").includes(index);
    cur = cur.cause;
  }
  return false;
}
