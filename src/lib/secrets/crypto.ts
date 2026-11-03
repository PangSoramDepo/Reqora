import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ALGORITHM = "aes-256-gcm";

/** Thrown when secrets can't be stored or read because no master key is configured. */
export class MissingKeyError extends Error {}

function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error("REQORA_SECRET_KEY must be 32 bytes (64 hex chars or base64)");
  return key;
}

let cached: Buffer | undefined;

/**
 * The secrets master key: REQORA_SECRET_KEY, or — outside production — a key generated once into
 * .data/secret.key so local development works without setup.
 */
export function masterKey(): Buffer {
  if (cached) return cached;
  if (process.env.REQORA_SECRET_KEY) return (cached = parseKey(process.env.REQORA_SECRET_KEY));
  if (process.env.NODE_ENV === "production" && !process.env.REQORA_ALLOW_DEV_KEY) {
    throw new MissingKeyError("REQORA_SECRET_KEY is not configured; the server can't encrypt or decrypt secrets");
  }
  const file = path.join(process.cwd(), ".data", "secret.key");
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return (cached = parseKey(readFileSync(file, "utf8")));
}

/** AES-256-GCM; output is base64(iv | tag | ciphertext). `context` is bound as AAD. */
export function encrypt(plaintext: string, context: string, key = masterKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decrypt(sealed: string, context: string, key = masterKey()): string {
  const raw = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
