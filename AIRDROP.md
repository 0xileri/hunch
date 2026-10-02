# Supporter airdrop

Public page: `/airdrop`. Campaign budget: $500 paid in HUNCH. This is a retroactive supporter campaign, separate from the creator bounty.

Publication cutoff: October 2, 2026, 10:47:12 UTC / 11:47:12 WAT. Launch lower bound: September 18, 2026, 22:12:26 UTC, matching the recorded launch timestamp. X snowflake timestamps reject posts outside this window. These timestamps establish publication eligibility only; they do not freeze or verify view counts.

Registration uses an expiring, single-use wallet signature bound to the campaign, website, handle and exact post links. Wallet signatures prove wallet ownership only. A confirmation reply on an original submitted X post is required for operator verification of the X account. The reply does not qualify for rewards. No payment, chain switching or token approval is requested. EOA browser wallets are supported; smart-contract wallet signatures and X OAuth are not implemented.

Entries persist atomically in `DATA_DIR/airdrop-supporters.json`, using the same mounted data directory as agent state. Duplicate wallets, handles and post IDs are rejected. Public lookups disclose only submission status and timestamp. Operators can read entries through `GET /api/admin/airdrop/entries` with `Authorization: Bearer ADMIN_TOKEN`. This route denies access if ADMIN_TOKEN is unset. Do not publish private entry exports.

Before opening claims:

1. Verify authorship, confirmation replies, original content and engagement; collect defensible view evidence. Historical views cannot be recovered just by freezing publication dates. Agree a measurement method and publish it before assigning rewards.
2. Finalize the distribution formula (the proposed 30% equal / 70% view-weighted formula was not approved), appeal window and excluded engagement rules.
3. Fix the USD-to-HUNCH conversion rate, approve allocations, deploy and fund a separately reviewed claim distributor, and integrate its transaction flow. Validate that total allocations cannot exceed the funded pool and each allocation can be claimed once.

The deployed registration page intentionally reports review status, null allocations and closed claims. No contract is deployed, treasury funds moved or tokens distributed by this change.

## Reviewed supporter cards

Operator-only review endpoint: `POST /api/admin/airdrop/:id/review` with the existing bearer token and JSON `{ "status": "approved", "amountHunch": "1250.5" }`, or `{ "status": "rejected" }`. Only approve after verifying X ownership and content, finalizing the reward formula and conversion rate, and checking the total pool. This records an allocation; it does not transfer funds or open claims.

Approved wallets see a downloadable 1200×675 PNG approval card and an X post composer. The post naturally tags @hunchmode and @orbiodotso, with no hashtags. A confirmed payout changes the card to claimed wording. X intents do not attach media automatically; supporters download and attach the image themselves.

Operator-only payout confirmation: `POST /api/admin/airdrop/:id/payout` with `{ "txHash": "0x…" }`. The server requires a successful Robinhood Chain receipt, six confirmations, and an exact HUNCH transfer from the configured treasury to the approved wallet. A transaction can be recorded only once. This endpoint does not send tokens. Public endpoints cannot approve entries or mark them claimed.

## Wallet connection

Connect opens a visible picker using EIP-6963 discovery, with legacy injected-provider fallback. The chosen provider handles both connection and message signing. Multiple installed wallets do not silently determine which provider signs. Account changes and disconnection clear the connected state. Cancelled and pending popup requests are shown beside the connection button and inside the picker. The script is served without caching and uses a versioned URL.

Browsers without wallet injection cannot sign directly. The picker offers MetaMask/Trust Wallet app browser links and a copyable page URL for opening in a wallet-enabled browser. It does not implement WalletConnect QR pairing. Do not describe those app links as a successful connection until the wallet actually authorizes the site.
