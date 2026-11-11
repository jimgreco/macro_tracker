// Shared helpers for asc-submit.mjs only. TestFlight upload and verification use
// the pinned release engine (jimgreco/release-tools/ios); this file keeps just the
// release policy and the App Store Connect JWT that the submit tooling imports.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const policy = JSON.parse(readFileSync(new URL('./release-policy.json', import.meta.url)));
const check = (ok, message) => { if (!ok) throw new Error(message); };
export function token(env = process.env) {
  const kid = env.APP_STORE_CONNECT_KEY_ID, iss = env.APP_STORE_CONNECT_ISSUER_ID, path = env.APP_STORE_CONNECT_API_KEY_PATH;
  check(kid && iss && path, 'Existing app-specific App Store Connect authentication is required.');
  const now = Math.floor(Date.now() / 1000);
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${b64({ alg: 'ES256', kid, typ: 'JWT' })}.${b64({ iss, aud: 'appstoreconnect-v1', iat: now, exp: now + 600 })}`;
  try {
    return `${input}.${sign('sha256', Buffer.from(input), { key: createPrivateKey(readFileSync(path)), dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  } catch { throw new Error('Existing app-specific API authentication could not be loaded.'); }
}
