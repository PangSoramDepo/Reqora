import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "./password";

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(1024),
  remember: z.boolean().default(false),
});

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    .max(1024),
  remember: z.boolean().default(false),
});

/** Open signup only bootstraps the first account, unless explicitly enabled for the deployment. */
export const signupOpen = (userCount: number) => userCount === 0 || process.env.REQORA_ALLOW_SIGNUP === "true";
