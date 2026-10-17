# XBT Live

An XBT-first client for a single [Corny Chat](https://cornychat.com) audio room,
served at https://live.nostronchain.com.

Audio, signaling, chat and room state all run on cornychat.com. This client
uses Corny Chat's own `jam-core` from `../ui`, so the protocol always matches
the server. What it adds:

- XBT first: tips default to XBT, with BTC one tap away.
- Lightning tips on either network. A profile's `lud16_xbt` is used for XBT;
  invoices are checked for the BLAKE2b feature bit (512/513) before they are
  shown, so an XBT tip can never quietly become a BTC one.
- On-chain tips to the speaker's Nostr Onchain address (their npub as a
  taproot key), handed to https://nostronchain.com/send, which signs XBT
  spends with SIGHASH_UNIFIED so they can't replay onto BTC.
- Nostr sign-in by browser extension or bunker link. Room roles listed by npub
  on Corny Chat (owner, moderator, speaker) apply here too.

The only change to Corny Chat's code is in `ui/lib/signalws.js`: the build
date its server checks on every socket is read from the server at runtime
(`window.jamBuildDate`) instead of being stamped in at image build time.

## Develop

    cd ui && npm install --ignore-scripts && node node_modules/esbuild/install.js
    cd ../live && npm install && npm run dev     # http://localhost:8830

`?room=<id>` picks another room; the default is `bitcoinnotbtc`.

## Deploy

    npm run build && cd dist && vercel --prod --yes

License: AGPL-3.0, same as Corny Chat.
