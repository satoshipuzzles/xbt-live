// Nostr: profiles, and one signer interface over a browser extension (NIP-07)
// or a remote bunker (NIP-46, e.g. the Pocket Signer bridge link).
import {nip19, generateSecretKey, getPublicKey} from 'nostr-tools';
import {SimplePool} from 'nostr-tools/pool';
import {BunkerSigner, parseBunkerInput} from 'nostr-tools/nip46';
import {bytesToHex, hexToBytes} from '@noble/hashes/utils';

export const RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://thebarn.nostr1.com',
  'wss://relay.nostronchain.com',
];

const pool = new SimplePool();
const profiles = new Map(); // hex pubkey -> Promise<profile|null>

export function npubToHex(npub) {
  try {
    const d = nip19.decode(npub);
    return d.type === 'npub' ? d.data : null;
  } catch {
    return null;
  }
}

export function getProfile(hex) {
  if (!hex) return Promise.resolve(null);
  if (!profiles.has(hex)) {
    profiles.set(
      hex,
      pool
        .querySync(RELAYS, {kinds: [0], authors: [hex]}, {maxWait: 4000})
        .then(events => {
          const e = events.sort((a, b) => b.created_at - a.created_at)[0];
          return e ? JSON.parse(e.content) : null;
        })
        .catch(() => null)
    );
  }
  return profiles.get(hex);
}

// ---- signer -------------------------------------------------------------

const BUNKER_KEY = 'xbtlive.bunker';
let signer = null; // {kind, getPublicKey(), signEvent(evt)}

export function currentSigner() {
  return signer;
}

export function hasExtension() {
  return typeof window.nostr?.signEvent === 'function';
}

export async function useExtension() {
  if (!hasExtension()) throw new Error('No Nostr extension found in this browser.');
  signer = {
    kind: 'extension',
    getPublicKey: () => window.nostr.getPublicKey(),
    signEvent: evt => window.nostr.signEvent(evt),
  };
  return signer;
}

export async function useBunker(input, onAuthUrl) {
  const bp = await parseBunkerInput(input.trim());
  if (!bp) throw new Error('That does not look like a bunker:// link.');
  let saved = loadBunker();
  const clientSecret =
    saved?.uri === input.trim() ? hexToBytes(saved.sk) : generateSecretKey();
  const b = new BunkerSigner(clientSecret, bp, {onauth: onAuthUrl});
  await b.connect();
  localStorage.setItem(
    BUNKER_KEY,
    JSON.stringify({uri: input.trim(), sk: bytesToHex(clientSecret)})
  );
  signer = {
    kind: 'bunker',
    getPublicKey: () => b.getPublicKey(),
    signEvent: evt => b.signEvent(evt),
  };
  return signer;
}

function loadBunker() {
  try {
    return JSON.parse(localStorage.getItem(BUNKER_KEY) || 'null');
  } catch {
    return null;
  }
}

// Re-attach the signer after a reload, without prompting.
export async function restoreSigner(npub) {
  if (!npub) return null;
  const want = npubToHex(npub);
  const saved = loadBunker();
  if (saved) {
    try {
      const bp = await parseBunkerInput(saved.uri);
      const b = new BunkerSigner(hexToBytes(saved.sk), bp, {});
      await b.connect();
      if ((await b.getPublicKey()) === want) {
        signer = {kind: 'bunker', getPublicKey: () => b.getPublicKey(), signEvent: e => b.signEvent(e)};
        return signer;
      }
    } catch {}
  }
  if (hasExtension()) {
    signer = {
      kind: 'extension',
      getPublicKey: () => window.nostr.getPublicKey(),
      signEvent: evt => window.nostr.signEvent(evt),
    };
    return signer;
  }
  return null;
}

export function forgetSigner() {
  signer = null;
  localStorage.removeItem(BUNKER_KEY);
}

// Corny Chat's login proof: a kind-1 event (never published) whose content is
// the room identity key. Its server checks this signature before honoring an
// npub listed among a room's owners, moderators or speakers.
export async function loginProof(s, myId) {
  const pubkey = await s.getPublicKey();
  const created_at = Math.floor(Date.now() / 1000);
  const signed = await s.signEvent({kind: 1, created_at, tags: [], content: myId, pubkey});
  return {
    pubkey,
    npub: nip19.npubEncode(pubkey),
    identity: {type: 'nostr', id: nip19.npubEncode(pubkey), loginTime: created_at, loginId: signed.id, loginSig: signed.sig},
  };
}

export {nip19, getPublicKey};
