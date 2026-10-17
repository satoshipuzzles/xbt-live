// Tip sheet: Lightning or on-chain, XBT first, BTC second.
import {h} from 'preact';
import {useEffect, useRef, useState} from 'preact/hooks';
import htm from 'htm';
import QrCreator from 'qr-creator';
import * as nostr from './nostr.js';
import * as ln from './lightning.js';
import {taprootAddress} from './taproot.js';

const html = htm.bind(h);
const AMOUNTS = [210, 1000, 2100, 5000, 21000];
const SEND_APP = 'https://nostronchain.com/send';
const CHAIN_LABEL = {xbt: 'XBT', btc: 'BTC'};

function Qr({text}) {
  const ref = useRef();
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';
    QrCreator.render({text, radius: 0.3, ecLevel: 'M', fill: '#0b0a08', background: '#f4efe2', size: 260}, ref.current);
  }, [text]);
  return html`<div class="qr" ref=${ref}></div>`;
}

function Copy({text, label = 'Copy'}) {
  const [done, setDone] = useState(false);
  return html`<button onClick=${async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {}
  }}>${done ? 'Copied ✓' : label}</button>`;
}

export function TipSheet({target, onClose, announce}) {
  const hex = nostr.npubToHex(target.npub);
  const [mode, setMode] = useState('ln');
  const [chain, setChain] = useState('xbt');
  const [amount, setAmount] = useState(1000);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const [profile, setProfile] = useState(undefined);
  const [lnAddr, setLnAddr] = useState(undefined); // undefined=loading, null=none
  const [invoice, setInvoice] = useState(null);
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const sats = custom ? Math.floor(Number(custom)) : amount;
  const name = profile?.display_name || profile?.name || target.name;

  useEffect(() => {
    nostr.getProfile(hex).then(p => setProfile(p || null));
  }, [hex]);

  useEffect(() => {
    setInvoice(null);
    setPaid(false);
    setErr('');
    if (profile === undefined) return;
    setLnAddr(undefined);
    ln.addressFor(profile, chain).then(setLnAddr, () => setLnAddr(null));
  }, [profile, chain]);

  // Watch for payment when the wallet offers a LUD-21 verify URL.
  useEffect(() => {
    if (!invoice?.verify || paid) return;
    const t = setInterval(async () => {
      if (await ln.isPaid(invoice.verify)) {
        setPaid(true);
        announce?.(`⚡ tipped ${name} ${sats.toLocaleString()} sats on ${CHAIN_LABEL[chain]} Lightning`);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [invoice, paid]);

  async function makeInvoice() {
    setErr('');
    if (!(sats > 0)) return setErr('Pick an amount.');
    setBusy(true);
    try {
      const info = await ln.payInfo(lnAddr);
      const msats = sats * 1000;
      if (msats < info.minSendable || msats > info.maxSendable)
        throw new Error(`This address takes ${Math.ceil(info.minSendable / 1000)}–${Math.floor(info.maxSendable / 1000).toLocaleString()} sats.`);
      let zapRequest;
      const s = nostr.currentSigner();
      if (info.allowsNostr && s) {
        try {
          const pubkey = await s.getPublicKey();
          zapRequest = await s.signEvent({
            kind: 9734,
            pubkey,
            created_at: Math.floor(Date.now() / 1000),
            content: note,
            tags: [['p', hex], ['amount', String(msats)], ['relays', ...nostr.RELAYS]],
          });
        } catch {
          zapRequest = undefined; // fall back to a plain tip
        }
      }
      const inv = await ln.fetchInvoice(info, msats, {comment: note, zapRequest});
      if (ln.invoiceChain(inv.pr) !== chain)
        throw new Error(`That wallet returned a ${CHAIN_LABEL[ln.invoiceChain(inv.pr)]} invoice, not ${CHAIN_LABEL[chain]}. Not showing it.`);
      setInvoice({...inv, zapped: !!zapRequest});
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function payWithWebln() {
    try {
      await window.webln.enable();
      await window.webln.sendPayment(invoice.pr);
      setPaid(true);
      announce?.(`⚡ tipped ${name} ${sats.toLocaleString()} sats on ${CHAIN_LABEL[chain]} Lightning`);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }

  const address = hex ? taprootAddress(hex) : null;
  const sendUrl = address && `${SEND_APP}?${new URLSearchParams({to: address, amount: String(sats || ''), chain})}`;

  return html`<div class="sheet-bg" onClick=${e => e.target === e.currentTarget && onClose()}>
    <div class="sheet tip">
      <button class="x" onClick=${onClose} aria-label="Close">✕</button>
      <h2>Tip ${name}</h2>

      <div class="seg">
        <button class=${mode === 'ln' ? 'on' : ''} onClick=${() => setMode('ln')}>⚡ Lightning</button>
        <button class=${mode === 'chain' ? 'on' : ''} onClick=${() => setMode('chain')}>⛓️ On-chain</button>
      </div>
      <div class="seg chain">
        <button class=${chain === 'xbt' ? 'on xbt' : ''} onClick=${() => setChain('xbt')}>XBT</button>
        <button class=${chain === 'btc' ? 'on' : ''} onClick=${() => setChain('btc')}>BTC</button>
      </div>

      ${!invoice &&
      html`<div class="amounts">
          ${AMOUNTS.map(a => html`<button key=${a} class=${!custom && amount === a ? 'on' : ''} onClick=${() => { setCustom(''); setAmount(a); }}>${a.toLocaleString()}</button>`)}
          <input inputmode="numeric" value=${custom} onInput=${e => setCustom(e.target.value.replace(/\D/g, ''))} placeholder="Other" />
        </div>
        <div class="muted small center">sats</div>`}

      ${mode === 'ln' &&
      html`<div>
        ${lnAddr === undefined
          ? html`<p class="muted center">Looking up ${name}'s ${CHAIN_LABEL[chain]} Lightning address…</p>`
          : lnAddr === null
          ? html`<p class="center">${name} hasn't published a ${CHAIN_LABEL[chain]} Lightning address.
              ${chain === 'xbt' ? ' Try BTC, or tip on-chain instead — that always works.' : ' Try XBT, or tip on-chain.'}</p>`
          : invoice
          ? html`<div class="center">
              ${paid
                ? html`<p class="paid">Paid. Thank you! 🧡</p>`
                : html`<${Qr} text=${'lightning:' + invoice.pr} />
                  <p class="small muted">${sats.toLocaleString()} sats on ${CHAIN_LABEL[chain]} Lightning to ${lnAddr}${invoice.zapped ? ' · sent as a Nostr zap' : ''}</p>
                  <div class="row center">
                    <a class="btn gold" href=${'lightning:' + invoice.pr}>Open wallet</a>
                    ${window.webln ? html`<button onClick=${payWithWebln}>Pay in browser</button>` : null}
                    <${Copy} text=${invoice.pr} label="Copy invoice" />
                  </div>
                  ${chain === 'xbt' ? html`<p class="small muted">Pay from an XBT Lightning wallet. A BTC Lightning wallet can't pay this invoice.</p>` : null}`}
              <button class="link" onClick=${() => setInvoice(null)}>← Change amount</button>
            </div>`
          : html`<div>
              <input value=${note} onInput=${e => setNote(e.target.value)} placeholder="Add a note (optional)" maxlength="140" />
              <button class="gold wide" disabled=${busy} onClick=${makeInvoice}>
                ${busy ? 'Getting invoice…' : `Tip ${(sats || 0).toLocaleString()} sats on ${CHAIN_LABEL[chain]}`}
              </button>
              <p class="small muted center">to ${lnAddr}</p>
            </div>`}
      </div>`}

      ${mode === 'chain' &&
      html`<div class="center">
        <${Qr} text=${address} />
        <p class="mono small">${address}</p>
        <div class="row center">
          <a class="btn gold" href=${sendUrl} target="_blank" rel="noopener">Send ${(sats || 0).toLocaleString()} sats with Nostr Onchain</a>
          <${Copy} text=${address} label="Copy address" />
        </div>
        <p class="small muted">
          ${name}'s Nostr Onchain address — the same address on XBT and BTC, spendable with their Nostr key.
          ${chain === 'xbt'
            ? ' Nostr Onchain signs XBT payments so they can’t be replayed on BTC.'
            : ' If your coins haven’t been split yet, Nostr Onchain warns you first, because a BTC payment from unsplit coins can be copied onto XBT.'}
        </p>
      </div>`}

      ${err ? html`<p class="err center">${err}</p>` : null}
    </div>
  </div>`;
}
