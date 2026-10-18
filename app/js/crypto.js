// Mission Control crypto — shared by the browser app and the Node CLI.
// Pure WebCrypto (globalThis.crypto.subtle), no dependencies.
//
// Key hierarchy
//   DEK (32 random bytes)  --HKDF "mc-data"-->  dataKey  (AES-256-GCM, encrypts every doc)
//                          --HKDF "mc-names"--> nameKey  (HMAC-SHA256, opaque file names)
//   VaultKey (32 bytes)    --HKDF "mc-vault"--> vaultKey (AES-256-GCM, encrypts the vault only)
//   DEK is wrapped by Saied's passphrase and the recovery code; the agent keeps a copy locally.
//   VaultKey is wrapped by the vault passphrase and the recovery code; the agent NEVER has it.
//   Agent ECDH P-256 keypair: approved secrets are sealed to its public key (grants).

const subtle = globalThis.crypto.subtle;
export const PBKDF2_ITERATIONS = 600_000;
const te = new TextEncoder();
const td = new TextDecoder();

export const utf8 = { encode: (s) => te.encode(s), decode: (b) => td.decode(b) };

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export const b64 = {
  encode(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  decode(str) {
    const s = atob(str.replace(/\s+/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

export const b64url = {
  encode: (bytes) => b64.encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    return b64.decode(s + '='.repeat((4 - (s.length % 4)) % 4));
  },
};

// ---------- passphrase wrapping ----------

export function newKdfParams() {
  return { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: b64.encode(randomBytes(16)) };
}

async function kekFromSecret(secret, kdf) {
  const base = await subtle.importKey('raw', utf8.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: kdf.hash, iterations: kdf.iterations, salt: b64.decode(kdf.salt) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Wrap raw key bytes with a passphrase. Returns a JSON-safe box. */
export async function wrapWithSecret(rawKey, secret, label) {
  const kdf = newKdfParams();
  const kek = await kekFromSecret(secret, kdf);
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(label) }, kek, rawKey);
  return { kdf, iv: b64.encode(iv), ct: b64.encode(new Uint8Array(ct)) };
}

/** Unwrap; throws 'BAD_SECRET' on wrong passphrase. */
export async function unwrapWithSecret(box, secret, label) {
  const kek = await kekFromSecret(secret, box.kdf);
  try {
    const raw = await subtle.decrypt(
      { name: 'AES-GCM', iv: b64.decode(box.iv), additionalData: utf8.encode(label) },
      kek,
      b64.decode(box.ct),
    );
    return new Uint8Array(raw);
  } catch {
    throw new Error('BAD_SECRET');
  }
}

// ---------- key derivation from DEK / VaultKey ----------

async function hkdf(raw, info, algo, usages) {
  const base = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8.encode(info) },
    base,
    algo,
    false,
    usages,
  );
}

/** From the raw DEK derive { dataKey, nameKey } (both non-extractable CryptoKeys). */
export async function deriveDataKeys(dekRaw) {
  const dataKey = await hkdf(dekRaw, 'mc-data', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']);
  const nameKey = await hkdf(dekRaw, 'mc-names', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']);
  return { dataKey, nameKey };
}

export async function deriveVaultKey(vaultRaw) {
  return hkdf(vaultRaw, 'mc-vault', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']);
}

/** Opaque, deterministic storage name for a logical doc path. */
export async function opaqueName(nameKey, logical) {
  const sig = new Uint8Array(await subtle.sign('HMAC', nameKey, utf8.encode(logical)));
  return [...sig.subarray(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- document encryption ----------

export async function encryptJSON(key, value, aad) {
  const iv = randomBytes(12);
  const pt = utf8.encode(JSON.stringify(value));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(aad) }, key, pt);
  return JSON.stringify({ v: 1, iv: b64.encode(iv), ct: b64.encode(new Uint8Array(ct)) });
}

export async function decryptJSON(key, text, aad) {
  const box = JSON.parse(text);
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64.decode(box.iv), additionalData: utf8.encode(aad) },
    key,
    b64.decode(box.ct),
  );
  return JSON.parse(utf8.decode(new Uint8Array(pt)));
}

// ---------- agent keypair + sealed grants ----------

export async function generateAgentKeys() {
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    publicJwk: await subtle.exportKey('jwk', kp.publicKey),
    privateJwk: await subtle.exportKey('jwk', kp.privateKey),
  };
}

async function grantKey(privateKey, publicKey, salt) {
  const bits = await subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  return hkdf(new Uint8Array(bits), 'mc-grant:' + salt, { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']);
}

/** Seal a JSON value so only the holder of the agent private key can open it. */
export async function sealToPublic(publicJwk, value) {
  const recipient = await subtle.importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const salt = b64.encode(randomBytes(16));
  const key = await grantKey(eph.privateKey, recipient, salt);
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8.encode(JSON.stringify(value)));
  return {
    epk: await subtle.exportKey('jwk', eph.publicKey),
    salt,
    iv: b64.encode(iv),
    ct: b64.encode(new Uint8Array(ct)),
  };
}

export async function openSealed(privateJwk, box) {
  const priv = await subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const epk = await subtle.importKey('jwk', box.epk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const key = await grantKey(priv, epk, box.salt);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64.decode(box.iv) }, key, b64.decode(box.ct));
  return JSON.parse(utf8.decode(new Uint8Array(pt)));
}

// ---------- recovery code ----------

const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

export function newRecoveryCode() {
  const bytes = randomBytes(20);
  let out = '';
  for (const b of bytes) out += B32[b & 31];
  return out.match(/.{5}/g).join('-');
}

export function normalizeRecoveryCode(code) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,5}/g)?.join('-') ?? '';
}

export async function sha256Hex(text) {
  const d = new Uint8Array(await subtle.digest('SHA-256', utf8.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
