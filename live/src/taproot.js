// The Nostr Onchain address for a Nostr key: the x-only pubkey used as a
// BIP-341 key-path taproot output (no script tree). Identical on XBT and BTC.
// Same derivation as nostronchain's src/lib/bitcoin/address.ts.
import {secp256k1} from '@noble/curves/secp256k1';
import {sha256} from '@noble/hashes/sha256';
import {concatBytes, hexToBytes} from '@noble/hashes/utils';
import {bech32m} from '@scure/base';

function taggedHash(tag, ...msgs) {
  const t = sha256(new TextEncoder().encode(tag));
  return sha256(concatBytes(t, t, ...msgs));
}

export function taprootAddress(xOnlyHex) {
  const x = hexToBytes(xOnlyHex);
  const P = secp256k1.ProjectivePoint.fromHex(concatBytes(new Uint8Array([2]), x));
  const t = BigInt('0x' + [...taggedHash('TapTweak', x)].map(b => b.toString(16).padStart(2, '0')).join(''));
  if (t >= secp256k1.CURVE.n) throw new Error('bad tweak');
  const Q = P.add(secp256k1.ProjectivePoint.BASE.multiply(t)).toRawBytes(true).slice(1);
  return bech32m.encode('bc', [1, ...bech32m.toWords(Q)]);
}

