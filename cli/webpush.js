// Zero-dependency Web Push: VAPID (RFC 8292, ES256 JWT) + aes128gcm payload encryption (RFC 8291).

import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function generateVapid() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { publicKey: b64u(raw), privateJwk: privateKey.export({ format: 'jwk' }) };
}

export function vapidHeader(endpoint, vapid, subject) {
  const enc = (o) => b64u(JSON.stringify(o));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })}`;
  const key = crypto.createPrivateKey({ key: vapid.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${vapid.publicKey}`;
}

const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

export function encryptPayload(keys, plaintext, { salt = crypto.randomBytes(16), ecdh } = {}) {
  const uaPublic = Buffer.from(keys.p256dh, 'base64url');
  const auth = Buffer.from(keys.auth, 'base64url');
  if (!ecdh) {
    ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
  }
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** Inverse of encryptPayload — used by tests to prove the encoding is correct. */
export function decryptPayload(uaEcdh, auth, buf) {
  const salt = buf.subarray(0, 16);
  const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen);
  const ct = buf.subarray(21 + idlen);
  const shared = uaEcdh.computeSecret(asPublic);
  const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return pt.subarray(0, pt.lastIndexOf(2)).toString();
}

/** Send one push. Returns { ok, status, gone } — gone=true means delete the subscription. */
export async function sendPush(sub, payload, vapid, subject) {
  const body = encryptPayload(sub.keys, JSON.stringify(payload));
  const headers = {
    TTL: '86400',
    Urgency: payload.urgency || 'high',
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    Authorization: vapidHeader(sub.endpoint, vapid, subject),
  };
  // Topic lets a newer push replace an undelivered older one with the same tag.
  if (payload.tag) headers.Topic = b64u(crypto.createHash('sha256').update(payload.tag).digest()).slice(0, 32);
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body }).catch(() => ({ ok: false, status: 0 }));
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
