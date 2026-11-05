import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  createSecretKey,
  privateDecrypt,
  publicEncrypt,
  sign as nodeSign,
  verify as nodeVerify,
  type CipherGCMTypes,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";

/**
 * The host side of `crypto.subtle` in the script sandbox. Scripts can't reach Node, so the sandbox's WebCrypto
 * shim sends each call here as JSON (binary data as base64) and gets JSON back. Keys travel as descriptors
 * holding their own DER/raw material, so nothing is kept between calls.
 *
 * Supported: digest; importKey / exportKey (raw, pkcs8, spki, jwk); sign / verify with HMAC,
 * RSASSA-PKCS1-v1_5, RSA-PSS, ECDSA and Ed25519; encrypt / decrypt with RSA-OAEP, AES-GCM and AES-CBC.
 */

type Algorithm = { name: string; hash?: string | { name: string }; [key: string]: unknown };
type KeyType = "secret" | "private" | "public";
/** What the sandbox's CryptoKey carries. `data` is base64 raw (secret), pkcs8 (private) or spki (public) DER. */
export type KeyDescriptor = {
  type: KeyType;
  extractable: boolean;
  algorithm: Algorithm;
  usages: string[];
  data: string;
};

class NotSupportedError extends Error {
  name = "NotSupportedError";
}
class InvalidAccessError extends Error {
  name = "InvalidAccessError";
}

const HASHES: Record<string, string> = { "SHA-1": "sha1", "SHA-256": "sha256", "SHA-384": "sha384", "SHA-512": "sha512" };
const SIGN_ALGORITHMS = ["HMAC", "RSASSA-PKCS1-v1_5", "RSA-PSS", "ECDSA", "Ed25519"];
const CIPHER_ALGORITHMS = ["RSA-OAEP", "AES-GCM", "AES-CBC"];

const b64 = (data: Uint8Array | Buffer) => Buffer.from(data).toString("base64");
const bytes = (data: unknown, what: string): Buffer => {
  if (typeof data !== "string") throw new TypeError(`${what} must be an ArrayBuffer or typed array`);
  return Buffer.from(data, "base64");
};

function normalize(algorithm: unknown): Algorithm {
  const alg = typeof algorithm === "string" ? { name: algorithm } : (algorithm as Algorithm);
  if (!alg || typeof alg.name !== "string") throw new TypeError("algorithm must be a name or { name, … }");
  const name = [...SIGN_ALGORITHMS, ...CIPHER_ALGORITHMS, ...Object.keys(HASHES)].find((n) => n.toUpperCase() === alg.name.toUpperCase());
  if (!name) throw new NotSupportedError(`algorithm "${alg.name}" is not supported in scripts`);
  const hash = alg.hash === undefined ? undefined : typeof alg.hash === "string" ? alg.hash : alg.hash.name;
  return { ...alg, name, ...(hash ? { hash: { name: hashName(hash) } } : {}) };
}

function hashName(hash: unknown): string {
  const name = typeof hash === "string" ? hash : (hash as { name?: string } | undefined)?.name;
  const found = Object.keys(HASHES).find((h) => h.toUpperCase() === String(name).toUpperCase());
  if (!found) throw new NotSupportedError(`hash "${name}" is not supported (use SHA-1, SHA-256, SHA-384 or SHA-512)`);
  return found;
}
const nodeHash = (alg: Algorithm) => HASHES[hashName(alg.hash)];

function keyObject(key: KeyDescriptor): KeyObject {
  const der = Buffer.from(key.data, "base64");
  if (key.type === "secret") return createSecretKey(der);
  if (key.type === "private") return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

function requireUsage(key: KeyDescriptor, usage: string, alg: Algorithm) {
  if (!key || typeof key.data !== "string") throw new TypeError("key must be a CryptoKey from crypto.subtle.importKey");
  if (!key.usages.includes(usage)) throw new InvalidAccessError(`the key was not imported for "${usage}"`);
  if (key.algorithm.name !== alg.name) {
    throw new InvalidAccessError(`the key is for ${key.algorithm.name}, not ${alg.name}`);
  }
}

function importKey(args: { format: string; keyData: unknown; algorithm: unknown; extractable: boolean; usages: string[] }): KeyDescriptor {
  const algorithm = normalize(args.algorithm);
  const usages = Array.isArray(args.usages) ? args.usages.map(String) : [];
  const base = { extractable: Boolean(args.extractable), usages };
  if (["RSASSA-PKCS1-v1_5", "RSA-PSS", "RSA-OAEP", "HMAC"].includes(algorithm.name) && !algorithm.hash) {
    throw new TypeError(`${algorithm.name} keys need a hash, e.g. { name: "${algorithm.name}", hash: "SHA-256" }`);
  }

  if (args.format === "raw") {
    const raw = bytes(args.keyData, "keyData");
    if (algorithm.name === "HMAC" || algorithm.name.startsWith("AES-")) {
      if (algorithm.name.startsWith("AES-") && ![16, 24, 32].includes(raw.length)) {
        throw new TypeError(`AES keys must be 16, 24 or 32 bytes (got ${raw.length})`);
      }
      return { ...base, type: "secret", algorithm: { ...algorithm, ...(algorithm.name.startsWith("AES-") ? { length: raw.length * 8 } : {}) }, data: b64(raw) };
    }
    throw new NotSupportedError(`"raw" import is supported for HMAC and AES keys; use spki or pkcs8 for ${algorithm.name}`);
  }

  let key: KeyObject;
  if (args.format === "pkcs8") key = createPrivateKey({ key: bytes(args.keyData, "keyData"), format: "der", type: "pkcs8" });
  else if (args.format === "spki") key = createPublicKey({ key: bytes(args.keyData, "keyData"), format: "der", type: "spki" });
  else if (args.format === "jwk") {
    const jwk = args.keyData as JsonWebKey;
    if (!jwk || typeof jwk !== "object") throw new TypeError("jwk keyData must be an object");
    if (jwk.kty === "oct") {
      const raw = Buffer.from(String(jwk.k ?? ""), "base64url");
      return { ...base, type: "secret", algorithm, data: b64(raw) };
    }
    key = jwk.d ? createPrivateKey({ key: jwk, format: "jwk" }) : createPublicKey({ key: jwk, format: "jwk" });
  } else {
    throw new NotSupportedError(`key format "${args.format}" is not supported (use raw, pkcs8, spki or jwk)`);
  }

  const type = key.type as KeyType;
  const der = type === "private" ? key.export({ format: "der", type: "pkcs8" }) : key.export({ format: "der", type: "spki" });
  const extra: Record<string, unknown> = {};
  if (key.asymmetricKeyType === "rsa" || key.asymmetricKeyType === "rsa-pss") {
    const details = key.asymmetricKeyDetails;
    extra.modulusLength = details?.modulusLength;
    extra.publicExponent = details?.publicExponent === undefined ? undefined : Number(details.publicExponent);
  }
  return { ...base, type, algorithm: { ...algorithm, ...extra }, data: b64(der) };
}

function exportKey(args: { format: string; key: KeyDescriptor }): unknown {
  const { key, format } = args;
  if (!key.extractable) throw new InvalidAccessError("the key is not extractable (import it with extractable = true)");
  const obj = keyObject(key);
  if (format === "jwk") return obj.export({ format: "jwk" });
  if (format === "raw" && key.type === "secret") return b64(obj.export());
  if (format === "pkcs8" && key.type === "private") return b64(obj.export({ format: "der", type: "pkcs8" }));
  if (format === "spki" && key.type === "public") return b64(obj.export({ format: "der", type: "spki" }));
  throw new NotSupportedError(`can't export a ${key.type} key as "${format}"`);
}

function signOrVerify(op: "sign" | "verify", args: { algorithm: unknown; key: KeyDescriptor; data: string; signature?: string }) {
  const alg = normalize(args.algorithm);
  requireUsage(args.key, op, alg);
  const data = bytes(args.data, "data");
  const key = keyObject(args.key);
  const keyAlg = args.key.algorithm;
  switch (alg.name) {
    case "HMAC": {
      const mac = createHmac(nodeHash(keyAlg), key).update(data).digest();
      if (op === "sign") return b64(mac);
      const signature = bytes(args.signature, "signature");
      return signature.length === mac.length && mac.equals(signature);
    }
    case "RSASSA-PKCS1-v1_5":
    case "RSA-PSS":
    case "ECDSA":
    case "Ed25519": {
      const hash = alg.name === "Ed25519" ? null : alg.name === "ECDSA" ? nodeHash(alg) : nodeHash(keyAlg);
      const options =
        alg.name === "RSA-PSS"
          ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: Number(alg.saltLength ?? 32) }
          : alg.name === "ECDSA"
            ? { key, dsaEncoding: "ieee-p1363" as const }
            : key;
      if (op === "sign") return b64(nodeSign(hash, data, options));
      return nodeVerify(hash, data, options, bytes(args.signature, "signature"));
    }
  }
  throw new NotSupportedError(`${alg.name} can't ${op}`);
}

function cipher(op: "encrypt" | "decrypt", args: { algorithm: unknown; key: KeyDescriptor; data: string }) {
  const alg = normalize(args.algorithm);
  requireUsage(args.key, op, alg);
  const data = bytes(args.data, "data");
  const key = keyObject(args.key);
  switch (alg.name) {
    case "RSA-OAEP": {
      const options = {
        key,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: nodeHash(args.key.algorithm),
        ...(alg.label === undefined ? {} : { oaepLabel: bytes(alg.label, "label") }),
      };
      return b64(op === "encrypt" ? publicEncrypt(options, data) : privateDecrypt(options, data));
    }
    case "AES-GCM": {
      const iv = bytes(alg.iv, "iv");
      const tagBytes = Number(alg.tagLength ?? 128) / 8;
      const name = `aes-${key.symmetricKeySize! * 8}-gcm` as CipherGCMTypes;
      const aad = alg.additionalData === undefined ? undefined : bytes(alg.additionalData, "additionalData");
      if (op === "encrypt") {
        const c = createCipheriv(name, key, iv, { authTagLength: tagBytes });
        if (aad) c.setAAD(aad);
        return b64(Buffer.concat([c.update(data), c.final(), c.getAuthTag()]));
      }
      const d = createDecipheriv(name, key, iv, { authTagLength: tagBytes });
      if (aad) d.setAAD(aad);
      d.setAuthTag(data.subarray(data.length - tagBytes));
      return b64(Buffer.concat([d.update(data.subarray(0, data.length - tagBytes)), d.final()]));
    }
    case "AES-CBC": {
      const name = `aes-${key.symmetricKeySize! * 8}-cbc`;
      const iv = bytes(alg.iv, "iv");
      const c = op === "encrypt" ? createCipheriv(name, key, iv) : createDecipheriv(name, key, iv);
      return b64(Buffer.concat([c.update(data), c.final()]));
    }
  }
  throw new NotSupportedError(`${alg.name} can't ${op}`);
}

/** Runs one crypto.subtle operation for the sandbox. Throws (name + message reach the script) on bad input. */
export function hostCrypto(op: string, args: Record<string, unknown>): unknown {
  switch (op) {
    case "digest":
      return b64(createHash(HASHES[hashName(typeof args.algorithm === "string" ? args.algorithm : (args.algorithm as Algorithm)?.name)]).update(bytes(args.data, "data")).digest());
    case "importKey":
      return importKey(args as Parameters<typeof importKey>[0]);
    case "exportKey":
      return exportKey(args as Parameters<typeof exportKey>[0]);
    case "sign":
    case "verify":
      return signOrVerify(op, args as Parameters<typeof signOrVerify>[1]);
    case "encrypt":
    case "decrypt":
      return cipher(op, args as Parameters<typeof cipher>[1]);
  }
  throw new NotSupportedError(`crypto.subtle.${op} is not supported in scripts`);
}
