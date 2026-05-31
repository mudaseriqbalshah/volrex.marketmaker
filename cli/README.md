# `mm` — Market Maker CLI

Headless, config-driven version of the web dashboard. Same engine
(`lib/engine/*`, `lib/chain.ts`, `lib/erc20.ts`, etc.) — only the UI and
persistence layers differ. Everything that the web app does, the CLI can
do, plus a price-aware market-maker mode that the web UI doesn't have.

## TL;DR

```bash
# 1. install deps (once)
npm install --legacy-peer-deps

# 2. set up your config
cp mm.config.example.yaml mm.config.yaml
chmod 600 mm.config.yaml       # private keys live here — keep it tight

# 3. edit mm.config.yaml — see "Configuration" below

# 4. generate trading wallets
npx mm gen-wallets --wallet-count 10

# 5. check balances on chain
npx mm balances

# 6. fund trading wallets
npx mm distribute --range 1-10 --min 0.01 --max 0.02

# 7. drive trades
npx mm fire --range 1-10 --side alternate --count 5
# or run a long-lived loop:
npx mm scheduler --scheduler-mode marketMaker
```

---

## Where do the private keys go?

Two keys are stored in `mm.config.yaml`:

```yaml
fundingWallet:
  # ADMIN funding wallet — holds VLRX, used by Distribute / Collect.
  # This is the wallet you control with your hardware/MetaMask.
  privateKey: "0xYOUR_ADMIN_PRIVATE_KEY"

tradingWallets:
  # Generated automatically by `mm gen-wallets`. You can also paste
  # existing keys if you want to re-use disposable wallets.
  - { label: w001, privateKey: "0x..." }
  - { label: w002, privateKey: "0x..." }
```

**Security rules**

1. `chmod 600 mm.config.yaml` — owner-only read/write.
2. `.gitignore` already excludes `mm.config.yaml`. Never commit it.
3. Use a **dedicated admin wallet**, not your personal one. The funding
   wallet's keys sit on disk; treat the disk as untrusted by default.
4. Strip the config of secrets before sharing logs.
5. The CLI never copies keys anywhere else — they're loaded directly
   into ethers `Wallet` objects in memory at runtime.

---

## Configuration

Single YAML file. Top-level sections:

```yaml
chain:        # which network and addresses to talk to
fundingWallet: # the admin wallet (single private key)
tradingWallets: # array of disposable wallets the bot uses to swap
token:        # the ERC-20 you're trading (one at a time)
engine:       # runtime tunables (concurrency, timeouts, etc.)
operation:    # what `mm run` should do — overridable via CLI flags
```

See [mm.config.example.yaml](../mm.config.example.yaml) for the full
schema with inline comments.

### Field-by-field

#### `chain`

| Field | Meaning |
|---|---|
| `chainId` | Numeric chain id (Volrex = `1378`) |
| `rpcUrls` | List of RPC endpoints; the CLI round-robins between them on each call |
| `routerAddress` | PancakeSwap-V2-style router (`IRoshiniRouter02`) |
| `wethAddress` | Wrapped-native contract (WVLRX on Volrex) |

#### `fundingWallet`

| Field | Meaning |
|---|---|
| `privateKey` | Admin wallet's private key. Holds VLRX; distributes to + collects from the trading wallets. Used internally as wallet id `"admin"`. |

#### `tradingWallets`

Array of objects with `label` and `privateKey`. Labels are used as
internal IDs for nonce tracking and logs. Generate fresh with
`mm gen-wallets`.

#### `token`

The single ERC-20 the bot trades against. (Only one token is active per
config; for multiple, use multiple config files.)

| Field | Meaning |
|---|---|
| `address` | ERC-20 contract address |
| `symbol` / `decimals` | Display only — must match the contract |
| `defaultSlippageBps` | Per-swap slippage tolerance (200 = 2%, 500 = 5%, 1000 = 10%). Bump higher on thin pools. |

#### `engine`

| Field | Default | Meaning |
|---|---|---|
| `maxConcurrent` | 5 | Max wallets dispatching tx in parallel |
| `gasMultiplier` | 1.1 | Multiply RPC-suggested gas price by this |
| `walletCooldownMs` | 3000 | Min ms between back-to-back dispatches from the same wallet (lets the pool settle) |
| `txTimeoutMs` | 45000 | Abandon a tx if broadcast OR confirmation exceeds this; worker moves on |

#### `operation`

Drives what `mm run` does — every field is overridable via CLI flag.

| Field | Type | For |
|---|---|---|
| `type` | `fire \| scheduler \| distribute \| collect \| balances \| gen-wallets \| clear` | Which command runs |
| `walletRange` | `[from, to]` or `"all"` | 1-based inclusive slice of trading wallets |
| `side` | `buy \| sell \| alternate` | fire |
| `amountMode` | `absolute \| percentage` | fire / scheduler |
| `amountMin` / `amountMax` | string | fire / scheduler — random jitter range |
| `count` | number | fire — repetitions per wallet |
| `distributeMin` / `distributeMax` | string | distribute — overrides `amountMin/Max` |
| `schedulerMode` | `random \| roundRobin \| marketMaker` | scheduler |
| `schedulerMinDelayMs` / `schedulerMaxDelayMs` | ms | random scheduler pacing |
| `schedulerCycleDelayMs` | ms | round-robin pacing |
| `schedulerBuyRatio` | 0..1 | random / round-robin buy bias |
| `mmTargetPrice` | string (native per 1 token) | marketMaker; empty → auto-capture on first tick |
| `mmToleranceBps` | bps | marketMaker band width (200 = ±2%) |
| `mmIntervalMs` | ms | marketMaker price-check + emit interval |
| `walletCount` | number | gen-wallets — how many to create |

---

## Commands

All commands take `--config <path>` (default `./mm.config.yaml`). All
flags override the corresponding `operation.<field>` in the config — so
you can keep one config file and tweak per run.

### `mm gen-wallets`

Create N random wallets, append them to `tradingWallets` in the config
file, and print their addresses. Re-writes the config in place (mode
`600`).

```bash
npx mm gen-wallets --wallet-count 25
```

### `mm balances`

Show native + active-token balances for the funding wallet and every
trading wallet. Read-only.

```bash
npx mm balances
```

### `mm distribute`

Queue `TransferETH` from the funding wallet to a range of trading
wallets. Each transfer's amount is a fresh random pick in
`[min, max]` so wallets don't all receive identical amounts.

```bash
# config-driven
npx mm distribute

# overrides
npx mm distribute --range 1-50 --min 0.005 --max 0.02
```

Waits until every transfer is mined before exiting.

### `mm collect`

Queue `TransferBackETH` from each wallet in range → funding wallet.
Each wallet keeps a small gas reserve (default 0.001 VLRX).

```bash
npx mm collect --range 1-50
```

### `mm fire`

One-shot batch of swaps. Builds N actions atomically and lets the
worker drain them.

```bash
# 5 buys per wallet on wallets 1-10, random 0.005-0.02 VLRX each
npx mm fire --range 1-10 --side buy --count 5 --min 0.005 --max 0.02

# alternate buy/sell, 30% of each wallet's balance per action
npx mm fire --range 1-25 --side alternate \
            --amount-mode percentage --min 20 --max 40 --count 10
```

### `mm scheduler`

Long-running loop. Three sub-modes via `--scheduler-mode`:

#### `random`

Pick a random wallet every `[minDelay, maxDelay]` ms and emit a Buy or
Sell biased by `buyRatio`.

```bash
npx mm scheduler --scheduler-mode random --range 1-25
```

#### `roundRobin`

Cycle through wallets in order with a fixed `cycleDelayMs` between
emissions.

```bash
npx mm scheduler --scheduler-mode roundRobin --range 1-25
```

#### `marketMaker` (real market maker)

Price-aware. Every `mmIntervalMs`:

1. Read the pool price via `getAmountsOut(1 token, [token, WETH])`.
2. Compare to the target band `[target × (1 − tol), target × (1 + tol)]`.
3. **Below the band** → emit a **Buy** to push price up.
   **Above the band** → emit a **Sell** to push price down.
   **Within the band** → emit a random Buy or Sell for natural-looking
   volume.
4. Pick the next wallet in round-robin order. Amount is jittered in
   `[amountMin, amountMax]`.

If `mmTargetPrice` is empty, the scheduler captures the price observed
at start and defends that — useful when you don't know an exact target
but want to stabilize the price as it is now.

```bash
# defend $0.0001 ± 2% across wallets 1-10
npx mm scheduler --scheduler-mode marketMaker --range 1-10

# (set operation.mmTargetPrice and mmToleranceBps in the config first)
```

Each tick logs `price`, `target`, the `decision` (`buy`/`sell`/`neutral`),
and which wallet was used:

```
[mm] price=0.00009800 target=0.00010000 → buy w003 0.0124
[mm] price=0.00010100 target=0.00010000 → sell w004 0.0098
[mm] price=0.00010000 target=0.00010000 → buy w005 0.0091   # within band, random
```

Stop with `Ctrl+C`: scheduler stops emitting, worker drains the
remaining queue, then the process exits cleanly.

### `mm clear`

Wipe `mm-state/queue.json` — useful if a prior run left a backlog you
no longer want.

```bash
npx mm clear
```

### `mm run`

Run whichever operation `operation.type` says in the config. Same as
running the explicit command of that type. Lets you commit a fully
configured run and execute with a single command.

```bash
npx mm run
```

---

## State + logs

Each config has its own state directory at `<config-dir>/mm-state/`:

| File | Contents |
|---|---|
| `mm-state/queue.json` | Pending + in-flight + recent done/failed actions (auto-trimmed at 10k) |
| `mm-state/log.jsonl` | Append-only history of every dispatched action (timestamp, kind, wallet, status, tx hash, error) |

Plain JSON — `cat`, `jq`, `tail -f` work normally:

```bash
tail -f mm-state/log.jsonl | jq .
```

`Ctrl+C`-then-re-run is safe: any actions in `running` state when the
prior process died are auto-reset to `queued` on the next start so the
worker can pick them up.

---

## Putting it all together — recipes

**Stand up a brand-new bot:**
```bash
cp mm.config.example.yaml mm.config.yaml
chmod 600 mm.config.yaml
# edit fundingWallet.privateKey and token.address
npx mm gen-wallets --wallet-count 20
npx mm balances                                # confirm funding wallet has VLRX
npx mm distribute --range 1-20 --min 0.01 --max 0.02
npx mm fire --range 1-20 --side buy --count 1  # seed each wallet with token
npx mm scheduler --scheduler-mode marketMaker  # real market making
```

**Tear it down:**
```bash
# Ctrl+C the scheduler
npx mm collect --range 1-20
npx mm balances                                # admin should have ~original
```

**Switch to volume mode quickly:**
```bash
# stop whatever's running, then:
npx mm scheduler --scheduler-mode random \
                 --range 1-20 \
                 --amount-mode percentage \
                 --min 15 --max 35
```

---

## Troubleshooting

- **"router or WETH address not configured"** — fill in
  `chain.routerAddress` and `chain.wethAddress`.
- **`UNCONFIGURED_NAME (value="")`** — same as above; an address field
  is empty.
- **Every swap reverts with `INSUFFICIENT_OUTPUT_AMOUNT`** — pool is
  thin. Raise `token.defaultSlippageBps` to 500 or 1000, or shrink
  `amountMin/Max`.
- **`no signer for <id>`** — wallet `label` referenced an action that
  doesn't exist in `tradingWallets`. Regenerate or fix labels.
- **CLI hangs on `distribute`/`fire`** — the worker is waiting for all
  in-flight tx receipts. Some RPC is slow. Either wait, lower
  `engine.txTimeoutMs`, or add more URLs to `chain.rpcUrls`.
