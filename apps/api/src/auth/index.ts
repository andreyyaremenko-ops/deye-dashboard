import { db } from "../db/client.ts";
import { createMailer } from "../mail/index.ts";
import { createAuth } from "./create-auth.ts";

export const auth = createAuth(db, createMailer((m) => console.log(m)));
