---
name: pharos-add-liquidity
description: >
  Use this skill to add concentrated liquidity to FaroSwap V3 pools on Pharos mainnet.
  Invoke whenever the user says "add liquidity", "adicionar liquidez", "provide liquidity",
  "fornecer liquidez", "LP position", "posição de LP", "WPROS/USDC pool",
  "FaroSwap liquidity", "V3 position", "create LP", "range order",
  "add to the pool", "colocar liquidez", "mint position", or any request
  to deposit token pairs into a Uniswap V3-style concentrated liquidity pool on Pharos.
  Do not attempt FaroSwap liquidity operations without this skill — tick math and
  NPM address are Pharos-specific and wrong values will silently mint an out-of-range position.
version: 1.0.0
author: community
license: MIT-0
requires:
  skills:
    - pharos-skill-engine
---

# Pharos Add Liquidity (FaroSwap V3)

Add concentrated liquidity to FaroSwap V3 (standard Uniswap V3 NonfungiblePositionManager) on Pharos mainnet. The result is an NFT representing the position.

## Contract & Pool Reference

| Contract | Address |
|----------|---------|
| NonfungiblePositionManager (NPM) | `0xc0479219f4feba5a668cff71bf96f4ffe124c3ab` |
| Factory | `0x2c90ccb0b989afa2433f499698451a25744a552b` |
| WPROS/USDC 0.01% pool (fee 100) | `0x912c9ade24d44d8922f0866d8dcb079f1363f647` |

## Token Reference

| Token | Address | Decimals | Role in WPROS/USDC pool |
|-------|---------|----------|------------------------|
| WPROS | `0x52c48d4213107b20bc583832b0d951fb9ca8f0b0` | 18 | token0 (lower address) |
| USDC | `0xc879c018db60520f4355c26ed1a6d572cdac1815` | 6 | token1 |

> **Token ordering:** `token0 < token1` by address. WPROS (`0x52c4...`) < USDC (`0xc879...`) → WPROS is always token0, USDC is token1. This affects tick direction and amount math.

## Fee Tiers & Tick Spacing

| Fee | Basis Points | Tick Spacing | Use Case |
|-----|-------------|--------------|----------|
| 100 | 0.01% | 1 | Stable pairs — **recommended for WPROS/USDC** |
| 500 | 0.05% | 10 | Stable-ish pairs |
| 3000 | 0.30% | 60 | Standard volatile |
| 10000 | 1.00% | 200 | Exotic / very volatile |

## Capability Index

| User Need | Action |
|-----------|--------|
| Add liquidity to WPROS/USDC with full range | Read price → compute ticks → approve × 2 → `NPM.mint` |
| Add with ±X% range around current price | Same, with percent-based tick computation |
| Add with explicit price range | Same, with price-to-tick conversion |
| Check current price of the pool | `pool.slot0()` → decode sqrtPriceX96 |
| View existing positions | `NPM.balanceOf` → `tokenOfOwnerByIndex` → `NPM.positions` |

---

## Execution Flow

### Step 1 — Write Operation Pre-checks

Follow **all** pre-checks from pharos-skill-engine:
1. Verify `$PRIVATE_KEY` is set
2. Derive address: `cast wallet address --private-key $PRIVATE_KEY`
3. Confirm: target is **Mainnet (chainId 1672)** — `https://rpc.pharos.xyz`

### Step 2 — Confirm Pool and Fee Tier

If the user specifies a fee tier, use it. Otherwise default to `fee = 100` for WPROS/USDC.

To verify or find a pool by fee tier:

```bash
cast call 0x2c90ccb0b989afa2433f499698451a25744a552b \
  "getPool(address,address,uint24)(address)" \
  0x52c48d4213107b20bc583832b0d951fb9ca8f0b0 \
  0xc879c018db60520f4355c26ed1a6d572cdac1815 \
  <FEE_TIER> \
  --rpc-url https://rpc.pharos.xyz
```

If it returns the zero address, that pool doesn't exist — pick a different fee tier.

### Step 3 — Read Current Price from Pool

```bash
cast call <POOL_ADDRESS> \
  "slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)" \
  --rpc-url https://rpc.pharos.xyz
```

The first return value is `sqrtPriceX96`. Decode to human price with node:

```bash
node -e "
  const sqrtPriceX96 = BigInt('<SQRT_PRICE_X96>');
  const Q96 = 2n ** 96n;
  // price_raw = (sqrtPriceX96 / Q96)^2 = USDC_raw / WPROS_raw
  // price_human (USDC per WPROS) = price_raw * 10^(18-6) = price_raw * 1e12
  const priceRaw = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q96 * Q96);
  const priceHuman = priceRaw * 1e12;
  console.log('sqrtPriceX96:', sqrtPriceX96.toString());
  console.log('Price (USDC per WPROS):', priceHuman.toFixed(6));
  // Current tick (approximate)
  const tick = Math.floor(Math.log(priceRaw) / Math.log(1.0001));
  console.log('Current tick:', tick);
"
```

Display to user: `Current price: ~<price> USDC per WPROS`

### Step 4 — Compute Tick Range

Select the range mode based on user input:

#### Mode A — Full Range

```
tickLower = Math.ceil(-887272 / TICK_SPACING) * TICK_SPACING
tickUpper = Math.floor( 887272 / TICK_SPACING) * TICK_SPACING
```

For fee 100 (spacing 1): `tickLower = -887272`, `tickUpper = 887272`

#### Mode B — Percent Range (±X% around current price)

```bash
node -e "
  const priceRaw = <PRICE_RAW>;    // (sqrtPriceX96/2^96)^2
  const pct = <PERCENT> / 100;
  const spacing = <TICK_SPACING>;
  const upperRaw = priceRaw * (1 + pct);
  const lowerRaw = priceRaw * (1 - pct);
  const tU = Math.floor(Math.log(upperRaw) / Math.log(1.0001) / spacing) * spacing;
  const tL = Math.ceil( Math.log(lowerRaw) / Math.log(1.0001) / spacing) * spacing;
  console.log('tickLower:', tL, '  tickUpper:', tU);
"
```

#### Mode C — Explicit Price Range (min/max in USDC per WPROS)

```bash
node -e "
  const minPrice = <MIN_USDC_PER_WPROS>;
  const maxPrice = <MAX_USDC_PER_WPROS>;
  const spacing = <TICK_SPACING>;
  // price_raw = price_human / 1e12
  const lowerRaw = minPrice / 1e12;
  const upperRaw = maxPrice / 1e12;
  const tL = Math.ceil( Math.log(lowerRaw) / Math.log(1.0001) / spacing) * spacing;
  const tU = Math.floor(Math.log(upperRaw) / Math.log(1.0001) / spacing) * spacing;
  console.log('tickLower:', tL, '  tickUpper:', tU);
"
```

### Step 5 — Compute Token Amounts

Given `tickLower`, `tickUpper`, current `sqrtPriceX96`, and one user-specified amount, compute the other:

```bash
node -e "
  const sqrtPriceX96 = BigInt('<SQRT_PRICE_X96>');
  const tickLower = <TICK_LOWER>;
  const tickUpper = <TICK_UPPER>;

  // Work in human-scale prices (USDC per WPROS) to avoid float cancellation
  // at the large negative ticks typical of this pool (~-282000).
  // Raw sqrtP ≈ 7.6e-7; squaring it gives ~5.8e-13, causing catastrophic
  // cancellation in (sqrtPb - sqrtP) → never use raw sqrtP in L formula.
  const sqrtRatio  = Number(sqrtPriceX96) / 2 ** 96;
  const priceHuman = sqrtRatio * sqrtRatio * 1e12; // USDC per WPROS

  const priceAtLower = (1.0001 ** tickLower) * 1e12;
  const priceAtUpper = (1.0001 ** tickUpper) * 1e12;

  const sqrtPh  = Math.sqrt(priceHuman);
  const sqrtPah = Math.sqrt(priceAtLower);
  const sqrtPbh = Math.sqrt(priceAtUpper);

  let amount0Wei, amount1Wei;

  if (priceHuman <= priceAtLower) {
    // Price below range: deposit only token0 (WPROS)
    const wpros = <USER_WPROS_AMOUNT>;
    amount0Wei = BigInt(Math.round(wpros * 1e18)).toString();
    amount1Wei = '0';
    console.log('Price below range — deposit WPROS only');
  } else if (priceHuman >= priceAtUpper) {
    // Price above range: deposit only token1 (USDC)
    const usdc = <USER_USDC_AMOUNT>;
    amount0Wei = '0';
    amount1Wei = BigInt(Math.round(usdc * 1e6)).toString();
    console.log('Price above range — deposit USDC only');
  } else {
    // Price inside range: compute both amounts from one input
    const wpros = <USER_WPROS_AMOUNT>;  // set to 0 if user specified USDC
    if (wpros > 0) {
      const L    = wpros * sqrtPh * sqrtPbh / (sqrtPbh - sqrtPh);
      const usdc = L * (sqrtPh - sqrtPah);
      amount0Wei = BigInt(Math.round(wpros * 1e18)).toString();
      amount1Wei = BigInt(Math.round(usdc * 1e6)).toString();
    } else {
      const usdc  = <USER_USDC_AMOUNT>;
      const L     = usdc / (sqrtPh - sqrtPah);
      const wpros2 = L * (sqrtPbh - sqrtPh) / (sqrtPh * sqrtPbh);
      amount0Wei  = BigInt(Math.round(wpros2 * 1e18)).toString();
      amount1Wei  = BigInt(Math.round(usdc * 1e6)).toString();
    }
  }
  console.log('amount0Desired (WPROS wei):', amount0Wei);
  console.log('amount1Desired (USDC raw) :', amount1Wei);
  // Apply 1% slippage for minimums
  console.log('amount0Min:', (BigInt(amount0Wei) * 99n / 100n).toString());
  console.log('amount1Min:', (BigInt(amount1Wei) * 99n / 100n).toString());
"
```

**Show user and confirm before approvals:**

```
Add liquidity:
  Pool  : WPROS/USDC  |  Fee: 0.01%  |  Tick range: [<tL>, <tU>]
  WPROS : <amount0 / 1e18>
  USDC  : <amount1 / 1e6>
  Range : <price_at_tL> – <price_at_tU> USDC/WPROS
Proceed?
```

### Step 6 — Approve Both Tokens to NPM

```bash
NPM=0xc0479219f4feba5a668cff71bf96f4ffe124c3ab

# Approve WPROS (skip if amount0Desired = 0)
cast send 0x52c48d4213107b20bc583832b0d951fb9ca8f0b0 \
  "approve(address,uint256)" $NPM <AMOUNT0_DESIRED> \
  --private-key $PRIVATE_KEY --rpc-url https://rpc.pharos.xyz

# Approve USDC (skip if amount1Desired = 0)
cast send 0xc879c018db60520f4355c26ed1a6d572cdac1815 \
  "approve(address,uint256)" $NPM <AMOUNT1_DESIRED> \
  --private-key $PRIVATE_KEY --rpc-url https://rpc.pharos.xyz
```

### Step 7 — Mint Position

Set `DEADLINE` = current timestamp + 600 seconds:

```bash
DEADLINE=$(node -e "console.log(Math.floor(Date.now()/1000) + 600)")
```

Call `NPM.mint` (selector `0x88316456`) with the MintParams tuple:

```bash
cast send 0xc0479219f4feba5a668cff71bf96f4ffe124c3ab \
  "mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))" \
  "(0x52c48d4213107b20bc583832b0d951fb9ca8f0b0,\
0xc879c018db60520f4355c26ed1a6d572cdac1815,\
<FEE>,<TICK_LOWER>,<TICK_UPPER>,\
<AMOUNT0_DESIRED>,<AMOUNT1_DESIRED>,\
<AMOUNT0_MIN>,<AMOUNT1_MIN>,\
<SENDER_ADDRESS>,${DEADLINE})" \
  --private-key $PRIVATE_KEY \
  --rpc-url https://rpc.pharos.xyz
```

After success, extract `tokenId` from the `IncreaseLiquidity` event log or the return data. Display:

```
Position minted!
  Token ID : <tokenId>
  NFT      : https://www.pharosscan.xyz/token/0xc0479219f4feba5a668cff71bf96f4ffe124c3ab?a=<tokenId>
  Tx       : https://www.pharosscan.xyz/tx/<transactionHash>
```

---

## Viewing Existing Positions

```bash
SENDER=<ADDRESS>

# Count positions
cast call 0xc0479219f4feba5a668cff71bf96f4ffe124c3ab \
  "balanceOf(address)(uint256)" $SENDER --rpc-url https://rpc.pharos.xyz

# Get tokenId at index 0
cast call 0xc0479219f4feba5a668cff71bf96f4ffe124c3ab \
  "tokenOfOwnerByIndex(address,uint256)(uint256)" $SENDER 0 --rpc-url https://rpc.pharos.xyz

# Get position details
cast call 0xc0479219f4feba5a668cff71bf96f4ffe124c3ab \
  "positions(uint256)(uint96,address,address,address,uint24,int24,int24,uint128,uint256,uint256,uint128,uint128)" \
  <TOKEN_ID> --rpc-url https://rpc.pharos.xyz
```

---

## Error Handling

| Error | Cause | Action |
|-------|-------|--------|
| `execution reverted: Price slippage check` | Actual amounts at time of mint < minimums | Recompute amounts with fresh slot0; retry or widen slippage to 2% |
| `execution reverted: TLU` (tickLower ≥ tickUpper) | Range crossed or equal | Re-check tick computation; ensure `tickLower < tickUpper` |
| `execution reverted: TLM` (tickLower < MIN_TICK) | Out-of-bound tick | Clamp to minimum: `-887272` rounded to spacing |
| `execution reverted: TUM` (tickUpper > MAX_TICK) | Out-of-bound tick | Clamp to maximum: `887272` rounded to spacing |
| `execution reverted: STF` (transfer failed) | Approval not confirmed or balance too low | Re-check `cast call token allowance`, reapprove |
| `getPool` returns zero address | Fee tier pool doesn't exist on FaroSwap | Use a different fee tier; default to 100 for WPROS/USDC |
| Both amount0Min and amount1Min are 0 | Wrong computation path | Ensure the non-zero desired amounts also produce non-zero minimums |

---

## Security Notes

- **Never log or display `$PRIVATE_KEY`.**
- **Simulation:** Before minting, verify computed tick range and amounts with the user — an out-of-range position earns no fees.
- **Slippage protection:** Always set `amount0Min` and `amount1Min` to at least 99% of desired amounts — never pass zero unless you understand the sandwich risk.
- **Approve exact amounts** — not `uint256.max` — unless the user explicitly requests it.
- Confirm **Mainnet (chainId 1672)** before every write operation.
- V3 positions are **NFTs** — the token ID is the ownership proof. Note it after minting.

---

## Example Prompts

**English:**
- "Add liquidity 5 WPROS to FaroSwap ±10% range, 0.01% fee"
- "Provide liquidity WPROS/USDC full range"
- "Add 100 USDC to the WPROS pool with 0.30% fee, ±5% range"
- "Show my FaroSwap positions"
- "What's the current WPROS/USDC price on FaroSwap?"

**Português:**
- "Adicionar liquidez 5 WPROS no FaroSwap range ±10%, taxa 0.01%"
- "Fornecer liquidez WPROS/USDC range completo"
- "Colocar 100 USDC no pool WPROS com taxa 0.30%, range ±5%"
- "Mostrar minhas posições no FaroSwap"
- "Qual o preço atual de WPROS/USDC no FaroSwap?"
