# Market Maker

Browser-based admin tool for operating multiple trading wallets against the SGC DEX (Pancake fork) on Volrex network.

## ⚠️ Security

- **This app custodies private keys.** Only run on a machine you trust.
- Use a **dedicated admin wallet** — never your personal wallet.
- The encrypted vault is *not* unbreakable: a weak password defeats it. Use 16+ characters, high entropy.
- **Never deploy this app to a public URL.** Run locally (`npm run dev`) or on a private host with IP allowlisting.
- Browser `localStorage` is reachable by any JS that runs in the page. Avoid third-party scripts and audit dependencies before updating.
- Closing the tab pauses the bot by design. The action queue is persisted (encrypted) and resumes on next unlock.

## Setup

1. Copy `.env.local.example` to `.env.local` and set:
   - `NEXT_PUBLIC_ADMIN_ADDRESS` — your admin wallet address (the only one allowed to sign in).
   - `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL` — chain target.
2. `npm install`
3. `npm run dev`
4. Open `http://localhost:3000`.
5. Connect admin wallet → sign challenge → set vault password → import/generate trading wallets → add tokens → start trading.

## Architecture

See [`docs/superpowers/specs/2026-05-23-market-maker-bot-design.md`](../docs/superpowers/specs/2026-05-23-market-maker-bot-design.md).

## Tests

```
npm test            # run once
npm run test:watch  # watch mode
```

## Operating modes

- **Manual** — fire individual actions from Dashboard buttons.
- **Random** — randomly sample a wallet, side, and amount within configured ranges.
- **Round-robin** — cycle through wallets in order.

Each mode produces actions onto the shared queue; the worker drains them with per-wallet nonce management and retry policy.
