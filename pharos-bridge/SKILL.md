---
name: pharos-bridge
description: >
  Use this skill to bridge tokens between Pharos and other chains, or into Pharos
  from external networks. Invoke whenever the user says "bridge", "cross-chain",
  "transferir entre redes", "send to Ethereum", "send to Base", "CCIP", "Chainlink bridge",
  "mover tokens para outra rede", "bridge PROS", "bridge USDC to Ethereum",
  "cross-chain transfer", "mandar para Arbitrum", "Jumper", "LI.FI bridge",
  or any request involving moving tokens from Pharos to another chain or vice versa.
  Two providers available: LI.FI/Jumper (general) and Chainlink CCIP (on-chain trustless).
  Do not attempt cross-chain transfers without reading this skill — routers, chain
  selectors, and token addresses are chain-specific and differ from DeFi token addresses.
version: 1.0.0
author: community
license: MIT-0
requires:
  skills:
    - pharos-skill-engine
---

# Pharos Bridge

Bridge tokens between Pharos (chainId 1672) and other EVM chains. Two providers:

- **Provider A — LI.FI/Jumper:** API-based, no API key, supports any LI.FI-listed bridge
- **Provider B — Chainlink CCIP:** On-chain trustless, specific token/lane combinations only

## Provider Selection

| Scenario | Recommended Provider |
|----------|---------------------|
| User says "Jumper", "LI.FI", or doesn't specify | **Provider A (LI.FI)** |
| User says "CCIP", "Chainlink bridge", or wants trustless on-chain | **Provider B (CCIP)** |
| Token/chain pair not supported by CCIP | Fall back to **Provider A** |

---

## Network & Chain Reference

| Chain | Name | chainId | CCIP Selector |
|-------|------|---------|---------------|
| Pharos | pharos | 1672 | `7801139999541420232` |
| Ethereum | ethereum | 1 | `5009297550715157269` |
| Base | base | 8453 | `15971525489660198786` |
| Arbitrum | arbitrum | 42161 | `4949039107694359620` |
| Polygon | polygon | 137 | `4051577828743386545` |
| Optimism | optimism | 10 | `3734403246176062136` |

## CCIP Router Addresses (source chain → Router to call)

| Source Chain | Router Address |
|-------------|----------------|
| Pharos | `0x4e52dD94e9BCfeFE3C78153bDfB0AB1d30687297` |
| Ethereum | `0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D` |
| Base | `0x881e3A65B4d4a04dD529061dd0071cf975F58bCD` |
| Arbitrum | `0x141fa059441E0ca23ce184B6A78bafD2A517DdE8` |
| Polygon | `0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe` |
| Optimism | `0x3206695CaE29952f4b0c22a169725a865bc8Ce0f` |

## CCIP Token Addresses ON PHAROS (differ from DeFi addresses!)

| Token | Pharos CCIP Address | Decimals | Supported Lanes (from Pharos) |
|-------|---------------------|----------|-------------------------------|
| USDC | `0x7126C3FeF4e6a680eeE09Fb039B2236F638384B0` | 6 | Ethereum |
| WETH | `0x1f4b7011Ee3d53969bb67F59428a9ec0477856E9` | 18 | Ethereum |
| WPROS | `0x52C48d4213107b20bC583832b0d951FB9CA8F0B0` | 18 | Base, Ethereum |
| LINK | `0x51e2A24742Db77604B881d6781Ee16B5b8fcBE29` | 18 | Ethereum |
| PGOLD | `0x531f1e4A3CA96b9f42467659d8088b07FE8D2839` | — | Arbitrum |
| USDpm | `0x16A7228ac1e772C5029d7069f3A6ECA66F894218` | — | Arbitrum |

> ⚠️ **CRITICAL:** Token addresses on Pharos for CCIP are different from DeFi (swap/liquidity) addresses. Always use the CCIP-specific addresses in this table for CCIP operations. Token addresses also differ on the destination chain — look up source-chain addresses in the official CCIP Directory.

---

## Provider A — LI.FI / Jumper

### Step 1 — Write Operation Pre-checks (pharos-skill-engine)

1. Verify `$PRIVATE_KEY` is set
2. Derive sender: `cast wallet address --private-key $PRIVATE_KEY`
3. Confirm user: sending from **<source chain>** to **<destination chain>**

### Step 2 — Resolve Tokens and Amount

Look up `fromChain` and `toChain` IDs from the Network Reference table above.

```bash
# Convert amount to wei (18-dec)
FROM_AMOUNT=$(cast to-wei <human_amount> ether)
# 6-dec tokens (USDC)
FROM_AMOUNT=$(node -e "console.log(Math.round(<human_amount> * 1e6).toString())")
```

### Step 3 — Fetch Cross-Chain Quote

```bash
curl -s "https://li.quest/v1/quote\
?fromChain=<FROM_CHAIN_ID>\
&toChain=<TO_CHAIN_ID>\
&fromToken=<FROM_TOKEN_ADDR>\
&toToken=<TO_TOKEN_ADDR>\
&fromAmount=<FROM_AMOUNT_WEI>\
&fromAddress=<SENDER_ADDRESS>\
&slippage=0.01" > /tmp/lifi_bridge_quote.json
cat /tmp/lifi_bridge_quote.json
```

Extract and display for user confirmation:

```bash
node -e "
  const q = require('/tmp/lifi_bridge_quote.json');
  const tx = q.transactionRequest;
  console.log('TO_AMOUNT:', q.estimate.toAmount);
  console.log('BRIDGE   :', q.toolDetails?.name ?? q.tool);
  console.log('EST_TIME :', q.estimate.executionDuration, 'seconds');
  console.log('TX_TO    :', tx.to);
  console.log('TX_DATA  :', tx.data);
  console.log('TX_VALUE :', tx.value ?? '0x0');
"
```

**Show user and wait for confirmation** (include estimated time — bridges are not instant):

```
Bridge quote:
  From : <amount> <FROM_TOKEN> on <FROM_CHAIN>
  To   : ~<toAmount / decimals> <TO_TOKEN> on <TO_CHAIN>
  Via  : <BRIDGE>  |  Est. time: ~<executionDuration / 60> min
Proceed?
```

### Step 4 — ERC20 Approval (if fromToken is not native)

```bash
# Check allowance
cast call <FROM_TOKEN_ADDR> \
  "allowance(address,address)(uint256)" \
  <SENDER_ADDRESS> <TX_TO> \
  --rpc-url https://rpc.pharos.xyz   # use source chain RPC

# Approve if needed
cast send <FROM_TOKEN_ADDR> \
  "approve(address,uint256)" \
  <TX_TO> <FROM_AMOUNT_WEI> \
  --private-key $PRIVATE_KEY \
  --rpc-url https://rpc.pharos.xyz
```

### Step 5 — Execute Bridge Transaction

```bash
TX_VALUE_DEC=$(node -e "console.log(BigInt('<TX_VALUE_HEX>').toString())")

cast send <TX_TO> \
  <TX_DATA> \
  --value ${TX_VALUE_DEC}wei \
  --private-key $PRIVATE_KEY \
  --rpc-url https://rpc.pharos.xyz   # SOURCE chain RPC
```

---

## Provider B — Chainlink CCIP

> ⚠️ **CCIP Warnings — read before executing:**
> 1. `getFee()` does **NOT** validate whether the token is registered on the lane — validation happens at `ccipSend`. A passing `getFee` call does not guarantee the transfer will succeed.
> 2. Token addresses **differ per chain**. The table above lists Pharos CCIP addresses. You must look up the equivalent address on the destination chain separately.
> 3. The transaction is **always sent to the SOURCE chain's Router** — never the destination.
> 4. Fees are paid in the **source chain's native token** (use `feeToken: address(0)`).
> 5. Cross-chain delivery is **not instant** — typically 10–20 minutes. Inform the user.

### Step 1 — Write Operation Pre-checks

Same as Provider A. Additionally:
- Confirm the token/lane combination is in the CCIP token table above.
- Identify: source chain Router, destination chain selector, token address on source chain.

### Step 2 — Resolve Parameters

```bash
SOURCE_ROUTER=<router_from_table>             # e.g. 0x4e52dD... for Pharos
DEST_SELECTOR=<selector_from_table>           # uint64, e.g. 5009297550715157269 for Ethereum
TOKEN_ADDR=<ccip_token_addr_on_source_chain>  # FROM the CCIP token table (Pharos column)
AMOUNT_WEI=<amount_in_wei>
RECIPIENT=<destination_address>               # receiver on the dest chain (same address usually)
```

### Step 3 — Compute extraArgs

> **Important:** The Pharos CCIP Router uses `EVMExtraArgsV1` (not `GenericExtraArgsV2`).
> Using `GenericExtraArgsV2` reverts with `InvalidExtraArgsTag()`.

```bash
# Compute EVMExtraArgsV1 selector (4 bytes) — tag: 0x97a657c9
EXTRA_TAG=$(cast keccak "CCIP EVMExtraArgsV1" | cut -c1-10)
# Encode: gasLimit=200000 (uint256, 32 bytes)
EXTRA_BODY=$(cast abi-encode "(uint256)" 200000)
# Concatenate (strip 0x from body)
EXTRA_ARGS="${EXTRA_TAG}${EXTRA_BODY:2}"
```

### Step 4 — Get Fee (dry run, no signing needed)

Build the message calldata and call `getFee` read-only:

```bash
# Encode receiver = abi.encode(address)
RECEIVER_BYTES=$(cast abi-encode "(address)" $RECIPIENT)

# Call getFee — read-only, no private key
cast call $SOURCE_ROUTER \
  "getFee(uint64,(bytes,bytes,(address,uint256)[],address,bytes))(uint256)" \
  $DEST_SELECTOR \
  "($RECEIVER_BYTES,0x,[($TOKEN_ADDR,$AMOUNT_WEI)],0x0000000000000000000000000000000000000000,$EXTRA_ARGS)" \
  --rpc-url https://rpc.pharos.xyz
```

Store as `FEE_WEI`. Display to user: `CCIP fee: <FEE_WEI / 1e18> native tokens`.

### Step 5 — Approve Token to Router

```bash
cast send $TOKEN_ADDR \
  "approve(address,uint256)" \
  $SOURCE_ROUTER $AMOUNT_WEI \
  --private-key $PRIVATE_KEY \
  --rpc-url https://rpc.pharos.xyz
```

### Step 6 — Send ccipSend

```bash
cast send $SOURCE_ROUTER \
  "ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))(bytes32)" \
  $DEST_SELECTOR \
  "($RECEIVER_BYTES,0x,[($TOKEN_ADDR,$AMOUNT_WEI)],0x0000000000000000000000000000000000000000,$EXTRA_ARGS)" \
  --value ${FEE_WEI}wei \
  --private-key $PRIVATE_KEY \
  --rpc-url https://rpc.pharos.xyz
```

Extract the returned `messageId` (bytes32). Display:

```
CCIP transfer initiated!
  MessageId : <messageId>
  From      : Pharos → <DEST_CHAIN>
  Token     : <AMOUNT> <TOKEN> to <RECIPIENT>
  Fee paid  : <FEE / 1e18> PROS
  Track at  : https://ccip.chain.link/msg/<messageId>
  ETA       : ~10–20 minutes
```

---

## Error Handling

| Error | Cause | Action |
|-------|-------|--------|
| LI.FI `"No route found"` | Chain pair not bridged by LI.FI | Try CCIP if token/lane supported; inform user |
| CCIP `execution reverted` on `ccipSend` | Token not registered on lane, or unsupported lane | Verify token address + lane in CCIP token table; use LI.FI instead |
| `getFee` reverts | Invalid `destChainSelector` or Router address | Check selector and router from the reference tables above |
| `execution reverted: ERC20: insufficient allowance` | Step 5 approval wasn't confirmed on-chain yet | Wait 1 block, retry |
| `insufficient funds` | Fee > native balance | Check balance; fee is ~0.01–0.1 native tokens |
| Token address gives zero `getFee` but `ccipSend` reverts | Token not registered on the declared lane | Do NOT proceed; look up correct lane |

---

## Security Notes

- **Never log or display `$PRIVATE_KEY`.**
- **Always verify TX_TO (LI.FI) is a known bridge contract** before sending — not an arbitrary address.
- **CCIP token addresses differ from DeFi token addresses** — double-check before every transfer.
- Bridges are **irreversible once sent** — confirm recipient address and destination chain carefully.
- Confirm **Mainnet (chainId 1672)** before every write operation on the source chain.
- Cross-chain transfers can take 10–30 minutes — warn the user, do not re-send if not immediate.

---

## Example Prompts

**English:**
- "Bridge 5 USDC from Pharos to Ethereum via CCIP"
- "Send 1 WPROS to Base using Chainlink"
- "Bridge 10 USDC from Pharos to Ethereum with LI.FI"
- "Move my WETH from Pharos to Ethereum"

**Português:**
- "Fazer bridge de 5 USDC da Pharos para Ethereum via CCIP"
- "Transferir 1 WPROS para Base usando Chainlink"
- "Mandar 10 USDC da Pharos para Ethereum pelo LI.FI"
- "Mover meu WETH da Pharos para Ethereum"
