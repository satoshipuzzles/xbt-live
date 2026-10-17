// XBT Live: an XBT-first client for one Corny Chat room. Audio, signaling and
// room state come from cornychat.com through Corny Chat's own jam-core.
import {h, render} from 'preact';
import {useEffect, useReducer, useState} from 'preact/hooks';
import htm from 'htm';
import {createJam} from '../../ui/jam-core';
import * as nostr from './nostr.js';
import {TipSheet} from './tips.js';

const html = htm.bind(h);

const params = new URLSearchParams(location.search);
const ROOM = params.get('room') || 'bitcoinnotbtc';
const UPSTREAM = 'https://cornychat.com';
const SOURCE = 'https://github.com/satoshipuzzles/xbt-live';
const HOST_NPUB = 'npub12r0yjt8723ey2r035qtklhmdj90f0j6an7xnan8005jl7z5gw80qat9qrx';

// cornychat.com refuses sockets from clients whose build date differs from its own.
const buildDateReady = fetch(`${window.jamConfig.urls.pantry}/api/v1/builddate/`)
  .then(r => r.json())
  .then(d => (window.jamBuildDate = d.bd))
  .catch(() => {});

const [state, api] = createJam({jamConfig: window.jamConfig});
buildDateReady.then(() => api.setProps('roomId', ROOM));
window.jam = {state, api};

// ---- helpers --------------------------------------------------------------

function useJamState() {
  const [, bump] = useReducer(n => n + 1, 0);
  useEffect(() => api.onState(undefined, () => bump()), []);
  return state;
}

function npubOf(info) {
  return info?.identities?.find(i => i.type === 'nostr')?.id || null;
}

function infoFor(id) {
  if (id === state.myId) return state.myIdentity?.info || {};
  return state.identities[id] || {};
}

function nameFor(id) {
  const info = infoFor(id);
  return info.name || `Guest ${String(id).slice(0, 4)}`;
}

function hasRole(list, id) {
  if (!list?.length) return false;
  return list.includes(id) || list.includes(npubOf(infoFor(id)));
}

function isSpeaker(id) {
  const {room, peerState, myPeerState} = state;
  const ps = id === state.myId ? myPeerState : peerState[id];
  if (ps?.leftStage) return false;
  return !!room.stageOnly || hasRole(room.speakers, id);
}

function Avatar({id, size = 64}) {
  const info = infoFor(id);
  const speaking = state.speaking?.has?.(id);
  const initials = nameFor(id).replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 2).toUpperCase() || '?';
  return html`<div class=${'av' + (speaking ? ' talking' : '')} style=${`width:${size}px;height:${size}px`}>
    ${info.avatar
      ? html`<img src=${info.avatar} alt="" loading="lazy" referrerpolicy="no-referrer" onError=${e => (e.target.style.display = 'none')} />`
      : html`<span>${initials}</span>`}
  </div>`;
}

// ---- people ---------------------------------------------------------------

function Person({id, onTip, host}) {
  const {peerState, myPeerState, room, reactions} = state;
  const me = id === state.myId;
  const ps = me ? myPeerState : peerState[id];
  const muted = me ? state.micMuted : ps?.micMuted;
  const hand = me ? state.handRaised : ps?.handRaised;
  const isOwner = hasRole(room.owners, id);
  const isMod = hasRole(room.moderators, id);
  const npub = npubOf(infoFor(id));
  const myReacts = (reactions[id] || []).slice(-3);
  const [menu, setMenu] = useState(false);
  const speaker = isSpeaker(id);

  return html`<div class="person">
    <button class="person-btn" onClick=${() => setMenu(!menu)} aria-label=${nameFor(id)}>
      <${Avatar} id=${id} />
      ${speaker && muted !== false ? html`<span class="badge mute" title="Muted">🔇</span>` : null}
      ${hand ? html`<span class="badge hand" title="Hand raised">✋</span>` : null}
      ${myReacts.map(([r, k], i) => html`<span key=${k} class="react" style=${`--i:${i}`}>${r}</span>`)}
    </button>
    <div class="pname">${isOwner ? '★ ' : isMod ? '☆ ' : ''}${nameFor(id)}${me ? ' (you)' : ''}</div>
    ${menu &&
    html`<div class="pmenu" onClick=${() => setMenu(false)}>
      ${npub && !me ? html`<button class="gold" onClick=${() => onTip({id, npub, name: nameFor(id)})}>⚡ Tip ${nameFor(id)}</button>` : null}
      ${!npub && !me ? html`<div class="muted small">Guest without Nostr — can't be tipped</div>` : null}
      ${host && !me && !room.stageOnly && !speaker
        ? html`<button onClick=${() => api.addSpeaker(ROOM, id)}>Invite to speak</button>`
        : null}
      ${host && !me && !room.stageOnly && speaker && !hasRole(room.owners, id)
        ? html`<button onClick=${() => api.removeSpeaker(ROOM, id)}>Move to listeners</button>`
        : null}
      ${npub ? html`<a href=${`https://njump.me/${npub}`} target="_blank" rel="noopener">Nostr profile ↗</a>` : null}
    </div>`}
  </div>`;
}

// ---- chat -----------------------------------------------------------------

function readChat() {
  try {
    return JSON.parse(localStorage.getItem(`${ROOM}.textchat`) || '[]');
  } catch {
    return [];
  }
}

function Chat() {
  const [lines, setLines] = useState(readChat);
  const [text, setText] = useState('');
  useEffect(() => {
    const t = setInterval(() => setLines(readChat()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const el = document.getElementById('chatlog');
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const shown = lines.filter(([, t, isdm]) => !isdm && t && !t.startsWith('/'));
  function send(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    api.sendTextChat(t);
    setText('');
  }
  return html`<section class="card chat">
    <h2>Chat</h2>
    <div id="chatlog" class="chatlog">
      ${shown.length === 0 ? html`<div class="muted small">No messages yet.</div>` : null}
      ${shown.map(([peer, t, , , time], i) => {
        const sys = t.startsWith('*') && t.endsWith('*');
        return html`<div key=${i} class=${'line' + (sys ? ' sys' : '')}>
          <b>${nameFor(peer)}</b> ${sys ? t.slice(1, -1) : stripImages(t)}
        </div>`;
      })}
    </div>
    ${state.inRoom
      ? html`<form class="chatform" onSubmit=${send}>
          <input value=${text} onInput=${e => setText(e.target.value)} placeholder="Say something" maxlength="500" />
          <button class="gold">Send</button>
        </form>`
      : html`<div class="muted small">Join the room to chat.</div>`}
  </section>`;
}

function stripImages(t) {
  return t.replace(/https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?/gi, '🖼️');
}

// ---- sign in --------------------------------------------------------------

function SignIn({onClose}) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [bunker, setBunker] = useState('');
  const [name, setName] = useState(state.myIdentity?.info?.name || '');
  const [authUrl, setAuthUrl] = useState('');

  async function finish(s) {
    setBusy('Signing your login…');
    const proof = await nostr.loginProof(s, state.myId);
    const profile = await nostr.getProfile(proof.pubkey);
    await api.updateInfo({
      name: profile?.display_name || profile?.name || name || undefined,
      avatar: profile?.picture || undefined,
      identities: [proof.identity],
    });
    onClose();
  }
  async function go(fn) {
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy('');
    }
  }
  return html`<div class="sheet-bg" onClick=${e => e.target === e.currentTarget && onClose()}>
    <div class="sheet">
      <h2>Sign in</h2>
      <p class="muted">Sign in with Nostr to get your name and picture, receive tips, and use your host controls if this is your room.</p>
      <button class="gold wide" disabled=${!!busy || !nostr.hasExtension()}
        onClick=${() => go(async () => finish(await nostr.useExtension()))}>
        ${nostr.hasExtension() ? 'Use my Nostr extension' : 'No Nostr extension found'}
      </button>
      <div class="or">or paste a bunker link (Pocket Signer, nsec.app, Amber)</div>
      <form onSubmit=${e => { e.preventDefault(); go(async () => { setBusy('Connecting to your signer…'); finish(await nostr.useBunker(bunker, u => setAuthUrl(u))); }); }}>
        <input value=${bunker} onInput=${e => setBunker(e.target.value)} placeholder="bunker://…" autocomplete="off" />
        <button class="wide" disabled=${!!busy || !bunker.trim()}>Connect signer</button>
      </form>
      ${authUrl ? html`<p class="small">Your signer wants approval: <a href=${authUrl} target="_blank" rel="noopener">open it</a>.</p>` : null}
      <div class="or">or just pick a name</div>
      <form onSubmit=${e => { e.preventDefault(); go(async () => { await api.updateInfo({name: name.trim()}); onClose(); }); }}>
        <input value=${name} onInput=${e => setName(e.target.value)} placeholder="Your name" maxlength="40" />
        <button class="wide" disabled=${!!busy || !name.trim()}>Use this name</button>
      </form>
      ${busy ? html`<p class="small">${busy}</p>` : null}
      ${err ? html`<p class="err">${err}</p>` : null}
    </div>
  </div>`;
}

// ---- host controls --------------------------------------------------------

function HostBar() {
  const {room} = state;
  const [busy, setBusy] = useState(false);
  async function patch(change) {
    setBusy(true);
    try {
      await api.updateRoom(ROOM, {...room, ...change});
    } finally {
      setBusy(false);
    }
  }
  return html`<section class="card host">
    <h2>Host controls</h2>
    <div class="row wrap">
      <button disabled=${busy} class=${room.closed ? 'gold' : ''} onClick=${() => patch({closed: !room.closed})}>
        ${room.closed ? 'Open the room' : 'Close the room'}
      </button>
      <button disabled=${busy} onClick=${() => patch({stageOnly: !room.stageOnly})}>
        ${room.stageOnly ? 'Switch to: raise hand to talk' : 'Switch to: everyone can talk'}
      </button>
    </div>
    <p class="muted small">
      ${room.closed ? 'Closed: only owners can get in. ' : 'Open to everyone. '}
      ${room.stageOnly ? 'Everyone can unmute and talk.' : 'Listeners raise a hand; tap them to invite them up.'}
    </p>
  </section>`;
}

// ---- app ------------------------------------------------------------------

function App() {
  useJamState();
  const [signIn, setSignIn] = useState(false);
  const [tip, setTip] = useState(null);
  const {room, hasRoom, inRoom, iAmOwner, iAmModerator, myId} = state;
  const myNpub = npubOf(state.myIdentity?.info);
  const host = iAmOwner || iAmModerator;

  useEffect(() => {
    if (myNpub) nostr.restoreSigner(myNpub);
  }, [myNpub]);
  useEffect(() => {
    document.title = room?.name ? `${room.name} · XBT Live` : 'XBT Live';
  }, [room?.name]);

  const here = [inRoom ? myId : null, ...state.peers.filter(p => state.peerState[p]?.inRoom)].filter(Boolean);
  const speakers = here.filter(isSpeaker);
  const listeners = here.filter(id => !isSpeaker(id));
  const closed = room.closed && !iAmOwner;

  async function join() {
    api.setProps({userInteracted: true});
    await buildDateReady;
    api.enterRoom(ROOM);
  }

  return html`<div class="wrap">
    <header class="top">
      <a class="brand" href="/"><img src="/icon.png" alt="" /> XBT Live</a>
      ${myNpub || state.myIdentity?.info?.name
        ? html`<button class="chip" onClick=${() => setSignIn(true)}><${Avatar} id=${myId} size=${24} /> ${nameFor(myId)}</button>`
        : html`<button class="chip" onClick=${() => setSignIn(true)}>Sign in</button>`}
    </header>

    <section class="hero card">
      ${room.logoURI ? html`<img class="logo" src=${room.logoURI} alt="" />` : null}
      <div>
        <h1>${room.name || (hasRoom ? ROOM : 'Loading room…')}</h1>
        ${room.description ? html`<p class="desc">${room.description.split('\n').filter(Boolean).join(' · ')}</p>` : null}
        <div class="status">
          ${closed
            ? html`<span class="pill off">Closed right now</span>`
            : html`<span class="pill on"><i></i> ${here.length || 0} in the room</span>`}
        </div>
      </div>
    </section>

    ${closed
      ? html`<section class="card"><p>The host hasn't opened the room yet. Keep this page open; it updates by itself. Hosts: sign in with Nostr to open it.</p></section>`
      : !inRoom
      ? html`<section class="card join">
          <button class="gold big" onClick=${join} disabled=${!hasRoom}>🎧 Join the room</button>
          <p class="muted small">You join muted. You can listen without signing in.</p>
        </section>`
      : null}

    ${host ? html`<${HostBar} />` : null}

    ${inRoom &&
    html`<section class="card controls">
      ${isSpeaker(myId)
        ? html`<button class=${state.micMuted ? '' : 'live'} onClick=${() => api.setProps('micMuted', !state.micMuted)}>
            ${state.micMuted ? '🎙️ Unmute' : '🔴 Mute'}
          </button>`
        : html`<button class=${state.handRaised ? 'gold' : ''} onClick=${() => api.setProps('handRaised', !state.handRaised)}>
            ${state.handRaised ? '✋ Lower hand' : '✋ Raise hand'}
          </button>`}
      <button class="gold" onClick=${() => setTip({npub: HOST_NPUB, name: 'the host'})}>⚡ Tip the host</button>
      <button onClick=${() => api.leaveRoom()}>Leave</button>
      ${state.audioPlayError ? html`<button class="gold" onClick=${() => api.retryAudio()}>🔊 Tap to hear audio</button>` : null}
      ${state.hasMicFailed ? html`<p class="err small">Your microphone is blocked. Allow it in your browser, then <a href="#" onClick=${e => { e.preventDefault(); api.retryMic(); }}>try again</a>.</p>` : null}
      ${state.otherDeviceInRoom ? html`<p class="muted small">You're also in this room on another device.</p>` : null}
      <div class="reacts">
        ${(room.customEmojis?.length ? room.customEmojis : ['🧡', '⚡', '🤙', '💯', '👏', '🤣', '🤔', '🍻'])
          .filter(e => !/^E\d|^http/.test(e))
          .slice(0, 10)
          .map(e => html`<button key=${e} class="emoji" onClick=${() => api.sendReaction(e)}>${e}</button>`)}
      </div>
    </section>`}

    ${!closed &&
    html`<section class="card">
      <h2>On stage <span class="count">${speakers.length}</span></h2>
      <div class="people">
        ${speakers.length === 0 ? html`<div class="muted small">Nobody on stage yet.</div>` : null}
        ${speakers.map(id => html`<${Person} key=${id} id=${id} host=${host} onTip=${setTip} />`)}
      </div>
      ${listeners.length > 0 &&
      html`<h2 style="margin-top:18px">Listening <span class="count">${listeners.length}</span></h2>
        <div class="people small">
          ${listeners.map(id => html`<${Person} key=${id} id=${id} host=${host} onTip=${setTip} />`)}
        </div>`}
    </section>`}

    ${!closed && html`<${Chat} />`}

    <footer class="foot">
      <p>
        <b>Powered by Corny Chat.</b>${' '}Audio, chat and the room itself run on${' '}
        <a href=${UPSTREAM} target="_blank" rel="noopener">cornychat.com</a>. This page is an
        independent XBT-first client for it and isn't run by the Corny Chat team.${' '}
        <a href=${`${UPSTREAM}/${ROOM}`} target="_blank" rel="noopener">Open this room on Corny Chat ↗</a>
      </p>
      <p>
        Tips go straight from your wallet to the speaker; this site never holds funds.
        Free software under the AGPL-3.0 ·${' '}<a href=${SOURCE} target="_blank" rel="noopener">source code</a>${' '}·
        part of${' '}<a href="https://nostronchain.com">Nostr Onchain</a>
      </p>
    </footer>

    ${signIn && html`<${SignIn} onClose=${() => setSignIn(false)} />`}
    ${tip &&
    html`<${TipSheet}
      target=${tip}
      onClose=${() => setTip(null)}
      announce=${msg => state.inRoom && api.sendTextChat(msg)}
    />`}
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
