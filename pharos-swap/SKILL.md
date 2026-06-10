---
name: pharos-swap
description: >
  Use this skill to swap tokens on Pharos mainnet via the LI.FI aggregator.
  Invoke whenever the user says "swap", "exchange", "convert", "sell", "buy tokens",
  "troca", "converter", "trocar tokens", "swap X for Y", "troca X por Y",
  "quanto USDC eu recebo por X PROS", "swap PROS", "swap WPROS", "swap USDC",
  or any request to exchange one token for another on Pharos Network (chainId 1672).
  Do not attempt a Pharos swap without reading this skill — wrong Diamond address
  or missing approval will cause the transaction to fail silently.
version: 1.0.0
author: community
license: MIT-0
requires:
  skills:
    - pharos-skill-engine
---

# Pharos Swap

Swap tokens on Pharos mainnet (chainId 1672) via the LI.FI aggregator API. No API key required. LI.FI returns a ready-to-sign `transactionRequest` (to, data, value) executed with `cast send`.

## Token Reference

| Token | Address | Decimals | Notes |
|-------|---------|----------|-------|
| PROS | `0x0000000000000000000000000000000000000000` | 18 | Native — no approval needed |
| WPROS | `0x52c48d4213107b20bc583832b0d951fb9ca8f0b0` | 18 | ERC20 |
| USDC | `0xc879c018db60520f4355c26ed1a6d572cdac1815` | 6 | ERC20 |

**LI.FI Diamond (ERC20 approval target):** `0xFf70F4A1d11995621854F3692acF286d8aCd04b2`

## Capability Index

| User Need | Steps |
|-----------|-------|
| Swap any known pair | Quote → ERC20 approval (if needed) → `cast send` |
| Preview quote / price impact | Fetch quote, display `toAmount` and route — no write op |

---

## Execution Flow

### Step 1 — Write Operation Pre-checks

Follow **all** pre-checks from pharos-skill-engine before proceeding:
1. Verify `$PRIVATE_KEY` is set: `[ -n "$PRIVATE_KEY" ] && echo "set" || echo "not set"`
2. Derive sender address: `cast wallet address --private-key $PRIVATE_KEY`
3. Confirm with user: target network is **Mainnet (chainId 1672)** — `https://rpc.pharos.xyz`

### Step 2 — Resolve Tokens and Convert Amount to Wei

Map token names to addresses from the table above. Convert the human amount to the correct raw unit:

```bash
# 18-decimal tokens (PROS, WPROS)
FROM_AMOUNT=$(cast to-wei <human_amount> ether)

# 6-decimal tokens (USDC)
FROM_AMOUNT=$(node -e "console.log(Math.round(<human_amount> * 1e6).toString())")
```

### Step 3 — Fetch LI.FI Quote

```bash
curl -s "https://li.quest/v1/quote\
?fromChain=1672\
&toChain=1672\
&fromToken=<FROM_TOKEN_ADDR>\
&toToken=<TO_TOKEN_ADDR>\
&fromAmount=<FROM_AMOUNT_WEI>\
&fromAddress=<SENDER_ADDRESS>\
&slippage=0.01" > /tmp/lifi_quote.json
cat /tmp/lifi_quote.json
```

Extract fields from the response with node (Python not available on this machine):

```bash
node -e "
  const q = require('/tmp/lifi_quote.json');
  const tx = q.transactionRequest;
  console.log('TO_AMOUNT :', q.estimate.toAmount);
  console.log('TX_TO     :', tx.to);
  console.log('TX_DATA   :', tx.data);
  console.log('TX_VALUE  :', tx.value ?? '0x0');
  console.log('ROUTE     :', q.tool ?? q.toolDetails?.name ?? 'LI.FI');
"
```

**Show the user this summary and wait for confirmation before proceeding:**

```
Swap quote:
  Send : <human_amount> <FROM_TOKEN>
  Receive: ~<toAmount / decimals> <TO_TOKEN>  (after 1% slippage)
  Route  : <ROUTE> via LI.FI on Pharos mainnet
  Diamond: 0xFf70F4A1d11995621854F3692acF286d8aCd04b2
Proceed?
```

### Step 4 — ERC20 Approval (skip entirely if fromToken is PROS native)

Check current allowance on the **token** contract (not the Diamond):

```bash
cast call <FROM_TOKEN_ADDR> \
  "allowance(address,address)(uint256)" \
  <SENDER_ADDRESS> \
  0xFf70F4A1d11995621854F3692acF286d8aCd04b2 \
  --rpc-url https://rpc.pharos.xyz
```

If the returned value is less than `FROM_AMOUNT_WEI`, send an exact approval:

```bash
cast send <FROM_TOKEN_ADDR> \
  "approve(address,uint256)" \
  0xFf70F4A1d11995621854F3692acF286d8aCd04b2 \
  <FROM_AMOUNT_WEI> \
  --private-key $PRIVATE_KEY \
  --rpc-url https://rpc.pharos.xyz
```

### Step 5 — Execute Swap

Convert `TX_VALUE` from hex to decimal wei:

```bash
TX_VALUE_DEC=$(node -e "console.log(BigInt('<TX_VALUE_HEX>').toString())")
```

Send the transaction:

```bash
cast send <TX_TO> \
  <TX_DATA> \
  --value ${TX_VALUE_DEC}wei \
  --private-key $PRIVATE_KEY \
  --rpc-url https://rpc.pharos.xyz
```

After confirmation extract `transactionHash` and display:

```
Swap executed!
  Tx: https://www.pharosscan.xyz/tx/<transactionHash>
```

---

## Error Handling

| Error / Signal | Cause | Action |
|----------------|-------|--------|
| LI.FI HTTP 404 / `"No route found"` | No liquidity for this pair or amount | Inform user; suggest different amount or pair |
| `"AMOUNT_TOO_LOW"` in LI.FI response | Amount below protocol minimum | Prompt user to increase the fromAmount |
| `execution reverted: STF` | ERC20 transfer failed — bad approval or zero balance | Re-check allowance (`cast call` token `allowance`) and balance |
| `execution reverted: Too little received` | Price moved past slippage bound | Re-fetch quote; suggest user retry or use `slippage=0.02` |
| `insufficient funds` | Native PROS balance too low for value + gas | `cast balance <addr> --rpc-url https://rpc.pharos.xyz --ether` |
| `TX_TO` not `0xFf70F...` | Unexpected route target — possible API issue | Warn user; do not send; re-fetch or abort |

---

## Security Notes

- **Never log or display `$PRIVATE_KEY`.** Always pass via env var — never inline in commands.
- **Verify `TX_TO` before sending.** It must be the LI.FI Diamond `0xFf70F4A1d11995621854F3692acF286d8aCd04b2` or a known Pharos DEX router. If it differs, warn the user and abort.
- **Exact approval only.** Approve the exact `fromAmount` — never `uint256.max` — unless the user explicitly asks for unlimited approval.
- **Non-custodial.** LI.FI routes tokens directly to `fromAddress`; no third-party holds funds mid-swap.
- Confirm **Mainnet** before every write operation — wrong network = real funds lost.

---

## Example Prompts

**English:**
- "Swap 5 PROS to USDC on Pharos"
- "Exchange 10 WPROS for PROS"
- "How much USDC would I get for 2 PROS? (just a quote, don't send)"
- "Convert all my WPROS to USDC"

**Português:**
- "Troca 5 PROS por USDC na Pharos"
- "Converter 10 WPROS em PROS"
- "Quanto USDC eu recebo por 2 PROS? (só cotação)"
- "Trocar todo meu WPROS por USDC"
