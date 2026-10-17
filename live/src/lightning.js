// Lightning tips on either network. An XBT Lightning node sets feature bit
// 512/513 (option_blake2b) on every invoice; BTC nodes never do. Addresses
// may also declare `"chain": "xbt"` in their LNURL-pay response, and Nostr
// profiles may carry a separate XBT address in `lud16_xbt`.
// Same rules as nostronchain's src/lib/nostr/lightning-chain.ts.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

export function invoiceChain(bolt11) {
  const pr = bolt11.trim().toLowerCase().replace(/^lightning:/, '');
  const sep = pr.lastIndexOf('1');
  const words = [...pr.slice(sep + 1)].map(c => CHARSET.indexOf(c));
  const data = words.slice(7, words.length - 6 - 104);
  let i = 0;
  while (i + 3 <= data.length) {
    const type = data[i];
    const len = data[i + 1] * 32 + data[i + 2];
    const val = data.slice(i + 3, i + 3 + len);
    i += 3 + len;
    if (type !== 5) continue;
    for (let w = 0; w < val.length; w++)
      for (let b = 0; b < 5; b++)
        if (val[w] & (1 << b)) {
          const bit = (val.length - 1 - w) * 5 + b;
          if (bit === 512 || bit === 513) return 'xbt';
        }
    return 'btc';
  }
  return 'btc';
}

function lnurlpUrl(address) {
  const [name, domain] = address.trim().toLowerCase().split('@');
  if (!name || !domain) throw new Error(`Not a Lightning address: ${address}`);
  return `https://${domain}/.well-known/lnurlp/${name}`;
}

const infoCache = new Map();
export function payInfo(address) {
  if (!infoCache.has(address)) {
    infoCache.set(
      address,
      fetch(lnurlpUrl(address))
        .then(r => {
          if (!r.ok) throw new Error(`${address} answered ${r.status}`);
          return r.json();
        })
        .then(d => {
          if (d.tag !== 'payRequest') throw new Error(d.reason || `${address} is not a payable address`);
          return d;
        })
    );
    infoCache.get(address).catch(() => infoCache.delete(address));
  }
  return infoCache.get(address);
}

const chainCache = new Map();
export async function addressChain(address) {
  if (chainCache.has(address)) return chainCache.get(address);
  const info = await payInfo(address);
  const one = String(info.chain || '').toLowerCase();
  const many = (info.chains || []).map(c => String(c).toLowerCase());
  let chain = null;
  if (one === 'xbt' || many.includes('xbt')) chain = 'xbt';
  else if (one === 'btc' || many.length) chain = 'btc';
  else {
    // Undeclared: ask for a minimum invoice (never paid) and read its bits.
    const inv = await fetchInvoice(info, info.minSendable);
    chain = invoiceChain(inv.pr);
  }
  chainCache.set(address, chain);
  return chain;
}

// The Lightning address to use for a profile on a given network, or null.
export async function addressFor(profile, chain) {
  if (!profile) return null;
  const xbt = profile.lud16_xbt?.trim();
  const main = profile.lud16?.trim();
  if (chain === 'xbt') {
    if (xbt) return xbt;
    if (main && (await addressChain(main).catch(() => null)) === 'xbt') return main;
    return null;
  }
  if (main && (await addressChain(main).catch(() => 'btc')) === 'btc') return main;
  return null;
}

export async function fetchInvoice(info, msats, {comment, zapRequest} = {}) {
  const url = new URL(info.callback);
  url.searchParams.set('amount', String(msats));
  if (comment && info.commentAllowed) url.searchParams.set('comment', comment.slice(0, info.commentAllowed));
  if (zapRequest && info.allowsNostr) url.searchParams.set('nostr', JSON.stringify(zapRequest));
  const r = await fetch(url);
  const d = await r.json();
  if (d.status === 'ERROR' || !d.pr) throw new Error(d.reason || 'The wallet did not return an invoice.');
  return d; // {pr, verify?}
}

// LUD-21: some addresses hand back a URL that reports when the invoice is paid.
export async function isPaid(verifyUrl) {
  try {
    const d = await (await fetch(verifyUrl)).json();
    return !!d.settled;
  } catch {
    return false;
  }
}
