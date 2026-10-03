# Supporter airdrop

Public page: `/airdrop`. Campaign budget: $500 paid in HUNCH. This is a retroactive supporter campaign, separate from the creator bounty.

Publication cutoff: October 2, 2026, 10:47:12 UTC / 11:47:12 WAT. Launch lower bound: September 18, 2026, 22:12:26 UTC, matching the recorded launch timestamp. X snowflake timestamps reject posts outside this window. These timestamps establish publication eligibility only; they do not freeze or verify view counts.

Registration uses an expiring, single-use wallet signature bound to the campaign, website, handle and exact post links. Wallet signatures prove wallet ownership only. A confirmation reply on an original submitted X post is required for operator verification of the X account. The reply does not qualify for rewards. No payment, chain switching or token approval is requested. EOA browser wallets are supported; smart-contract wallet signatures and X OAuth are not implemented.

Entries persist atomically in `DATA_DIR/airdrop-supporters.json`, using the same mounted data directory as agent state. Duplicate wallets, handles and post IDs are rejected. Public lookups disclose only submission status and timestamp. Operators can read entries through `GET /api/admin/airdrop/entries` with `Authorization: Bearer ADMIN_TOKEN`. This route denies access if ADMIN_TOKEN is unset. Do not publish private entry exports.

Before opening claims:

1. Verify authorship, confirmation replies, original content and engagement; collect defensible view evidence. Historical views cannot be recovered just by freezing publication dates. Agree a measurement method and publish it before assigning rewards.
2. Approved distribution: 24 qualifying accounts receive $10 each, plus a proportional share of $250 by current qualifying post views. Two reply exceptions (@bywrny and @7teen_wtf) receive $5 each. Total: $500. @mrlarry100x is rejected; @mrbankalart is not included. The creator @0xileri is included as instructed. Per-post views and the USD ledger are private operator records.
3. Fix the USD-to-HUNCH conversion rate and fund the dedicated airdrop treasury with all HUNCH allocations plus ETH for gas. Claims remain closed until explicitly enabled after funding checks.

No new contract is deployed. Claims use server-sponsored ERC20 transfers from a separate persistent treasury, independent of the agent operating wallet. An authenticated claim signs a campaign/domain/chain/token/wallet/handle/amount-bound nonce, and receives its fixed allocation at its originally registered wallet. Claim cards are displayed only after six confirmations and an exact matching Transfer event.

## Dedicated claim treasury

`POST /api/admin/airdrop/treasury/initialize` with `{}` creates a random treasury once and returns only its public address, chain, and token. The private key is stored at `DATA_DIR/airdrop-treasury-secret.json`, created exclusively with restrictive permissions on Railway's persistent volume. Back up that file securely through the host before funding; never put it in Git or share it. Volume loss without a backup means loss of access to this treasury.

`GET /api/admin/airdrop/treasury` returns balances and required token funding. Fund it on Robinhood Chain (4663) with HUNCH and ETH for gas. No token approval by claimants is required.

`POST /api/admin/airdrop/claims/configure`: `{ "priceUsd": "0.001", "rewards": [{ "handle": "username", "usdCents": 1000 }, ...] }` installs all 26 unique allocations at once, requires exactly 50000 cents, validates reviewed accounts and the two 500-cent exceptions, and leaves claims closed. USD/token conversions round down at 18 token decimals. Once any payout is prepared, allocations cannot change. Do not use the example price without operator direction.

`POST /api/admin/airdrop/claims/enabled`: `{ "enabled": true }` opens claims only if the entire unpaid pool and positive ETH balance are present. The public challenge checks the original wallet and matching handle; the signed request confirms wallet ownership. Following @hunchmode and @_ValeriusX is a declaration with explicit follow links, not an X API verification.

The operator selected an exact pool of **118,000,000 HUNCH** instead of a quoted token price. Configure with `totalHunch: "118000000"` in place of `priceUsd`; rewards use each recipient's share of the approved 50000-cent ledger. This means 236,000 HUNCH per allocation dollar, a 2,360,000 HUNCH base, and 1,180,000 HUNCH for each reply exception. USD values represent allocation weights and approximate campaign value, not guaranteed market value.

The full signed transfer and its hash are persisted before broadcasting. Only one unresolved treasury transaction is allowed; retries rebroadcast that exact transfer so a response timeout or restart cannot issue a second payout. Failed receipts remain blocked for operator investigation rather than automatically issuing another transfer. Deploy exactly one app replica with the persistent volume; this JSON-backed implementation does not support multiple concurrent server replicas. A crashed request resumes when the same claimant signs a fresh request. Claimed cards reflect transferred HUNCH, not investment profit or loss.

## Reviewed supporter cards

Operator-only review endpoint: `POST /api/admin/airdrop/:id/review` with the existing bearer token and JSON `{ "status": "approved", "amountHunch": "1250.5" }`, or `{ "status": "rejected" }`. Only approve after verifying X ownership and content, finalizing the reward formula and conversion rate, and checking the total pool. This records an allocation; it does not transfer funds or open claims.

Approved wallets see a downloadable 1200×675 PNG approval card and an X post composer. The post naturally tags @hunchmode and @orbiodotso, with no hashtags. A confirmed payout changes the card to claimed wording. X intents do not attach media automatically; supporters download and attach the image themselves.

Operator-only payout confirmation: `POST /api/admin/airdrop/:id/payout` with `{ "txHash": "0x…" }`. The server requires a successful Robinhood Chain receipt, six confirmations, and an exact HUNCH transfer from the configured treasury to the approved wallet. A transaction can be recorded only once. This endpoint does not send tokens. Public endpoints cannot approve entries or mark them claimed.

## Wallet connection

Connect opens a visible picker using EIP-6963 discovery, with legacy injected-provider fallback. The chosen provider handles both connection and message signing. Multiple installed wallets do not silently determine which provider signs. Account changes and disconnection clear the connected state. Cancelled and pending popup requests are shown beside the connection button and inside the picker. The script is served without caching and uses a versioned URL.

Browsers without wallet injection cannot sign directly. The picker offers MetaMask/Trust Wallet app browser links and a copyable page URL for opening in a wallet-enabled browser. It does not implement WalletConnect QR pairing. Do not describe those app links as a successful connection until the wallet actually authorizes the site.
