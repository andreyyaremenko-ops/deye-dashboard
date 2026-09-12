/**
 * Відправка листів. Якщо SMTP не налаштований — лист пишеться в лог
 * (dev-режим і поки немає провайдера).
 */
import nodemailer from "nodemailer";
import { config } from "../config.ts";

export interface Mail { to: string; subject: string; text: string; html?: string }
export type Mailer = (mail: Mail) => Promise<void>;

export function createMailer(log: (msg: string) => void): Mailer {
  if (!config.SMTP_HOST) {
    return async (m) => log(`[mail:dev] to=${m.to} subject="${m.subject}"\n${m.text}`);
  }
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
  return async (m) => { await transport.sendMail({ from: config.MAIL_FROM, ...m }); };
}
