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
