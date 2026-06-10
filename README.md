# Pharos DeFi Skills — Agent Carnival Phase 1

Three production-tested Claude Code skills for the Pharos Agent ecosystem, built on the official **pharos-skill-engine**. Every capability listed here was verified with real transactions on **Pharos mainnet (chainId 1672)**.

---

## Skills at a Glance

| Skill | What it does | Mainnet proof |
|---|---|---|
| **pharos-swap** | Token swaps on Pharos via LI.FI aggregator | [0x01723efe…](https://www.pharosscan.xyz/tx/0x01723efe811807760ad1a47ee44f610526f24dbcd034de2e733660f1052e1b33) |
| **pharos-bridge** | Cross-chain bridging via LI.FI/Jumper + Chainlink CCIP | [0x7569cf98…](https://www.pharosscan.xyz/tx/0x7569cf983212734d7e4ad25b17ea4f18b6c0f6a69b89129a58128b7d4b389089) |
| **pharos-add-liquidity** | FaroSwap V3 concentrated liquidity with full tick math | [NFT #2854 / 0xc00aacee…](https://www.pharosscan.xyz/tx/0xc00aaceeebeca9a97f95141464a28558b50923c36ab68d7d772dc07832db91ff) |

All three skills follow the `pharos-skill-engine` SKILL.md format exactly: YAML frontmatter declaring `requires: pharos-skill-engine`, a capability index, step-by-step execution flow, error tables, and bilingual (EN/PT) example prompts.

---

## Repository Layout

```
pharos-defi-skills/
├── pharos-swap/
│   └── SKILL.md              ← swap skill (LI.FI)
├── pharos-bridge/
│   └── SKILL.md              ← bridge skill (LI.FI + Chainlink CCIP)
├── pharos-add-liquidity/
│   └── SKILL.md              ← FaroSwap V3 liquidity skill
├── pharos-skill-engine/      ← official engine (dependency reference)
│   └── pharos-skill-engine-0.1.0/
│       ├── SKILL.md
│       ├── assets/           ← networks.json, tokens.json, templates
│       └── references/       ← query.md, transaction.md, contract.md
├── swap_exec.js              ← agent-generated test script for pharos-swap
├── bridge_exec.js            ← agent-generated test script for pharos-bridge
├── liquidity_exec.js         ← agent-generated test script for pharos-add-liquidity
├── check_base.js             ← read USDC balance on Base (post-bridge verify)
├── keccak256.js              ← pure-JS keccak-256 (no native deps, for CCIP encoding)
├── package.json              ← ethers v6 (used by exec scripts)
├── .env.example              ← copy to .env, fill PRIVATE_KEY
└── .gitignore                ← excludes .env, node_modules, temp files
```

---

## Skill 1 — `pharos-swap`

**Trigger keywords:** swap, exchange, convert, sell, buy tokens, troca, converter, trocar tokens

Fetches a ready-to-sign transaction from the **LI.FI aggregator API** (no API key required) and executes it via the LI.FI Diamond on Pharos mainnet. Native PROS swaps require no ERC20 approval; ERC20 swaps get an exact-amount approval before sending.

### Token Reference

| Token | Address | Decimals |
|-------|---------|----------|
| PROS | `0x0000000000000000000000000000000000000000` | 18 (native) |
| WPROS | `0x52c48d4213107b20bc583832b0d951fb9ca8f0b0` | 18 |
| USDC | `0xc879c018db60520f4355c26ed1a6d572cdac1815` | 6 |

**LI.FI Diamond:** `0xFf70F4A1d11995621854F3692acF286d8aCd04b2`

### Flow
1. Resolve token addresses and convert amount to wei
2. `GET https://li.quest/v1/quote?fromChain=1672&toChain=1672&...`
3. Verify `TX_TO == LI.FI Diamond` before any write
4. ERC20 approval if needed (skip for native PROS)
5. `cast send` / `wallet.sendTransaction` with `value = tx.value`

### Example Prompts
```
"Swap 5 PROS to USDC on Pharos"
"How much USDC would I get for 2 PROS? (quote only)"
"Troca 10 WPROS por USDC"
```

### Real Test Result
- Input: 0.1 PROS → Output: **+0.058862 USDC**
- Route: Fly DEX via LI.FI Diamond
- Gas used: 271,175 — [Pharosscan](https://www.pharosscan.xyz/tx/0x01723efe811807760ad1a47ee44f610526f24dbcd034de2e733660f1052e1b33)

---

## Skill 2 — `pharos-bridge`

**Trigger keywords:** bridge, cross-chain, CCIP, Chainlink bridge, send to Base/Ethereum/Arbitrum, transferir entre redes

Two bridge providers in one skill:

| Provider | When to use |
|----------|-------------|
| **LI.FI / Jumper** | Default; any LI.FI-listed token/chain pair |
| **Chainlink CCIP** | When user asks explicitly; on-chain trustless; specific lanes only |

### Supported Networks

| Chain | chainId | CCIP Selector |
|-------|---------|---------------|
| Pharos | 1672 | `7801139999541420232` |
| Ethereum | 1 | `5009297550715157269` |
| Base | 8453 | `15971525489660198786` |
| Arbitrum | 42161 | `4949039107694359620` |
| Polygon | 137 | `4051577828743386545` |
| Optimism | 10 | `3734403246176062136` |

### CCIP Routers

| Chain | Router |
|-------|--------|
| Pharos | `0x4e52dD94e9BCfeFE3C78153bDfB0AB1d30687297` |
| Base | `0x881e3A65B4d4a04dD529061dd0071cf975F58bCD` |
| Ethereum | `0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D` |
| Arbitrum | `0x141fa059441E0ca23ce184B6A78bafD2A517DdE8` |

### LI.FI Bridge Flow
1. Resolve chain IDs and token addresses
2. Fetch cross-chain quote from `li.quest/v1/quote`
3. ERC20 approval to LI.FI Diamond if needed
4. Send bridge tx on source chain; await confirmation
5. Poll destination chain RPC for balance increase

### CCIP Flow
1. Compute `EVMExtraArgsV1` extraArgs (`keccak256("CCIP EVMExtraArgsV1")[:4]` + `gasLimit`)
2. Call `getFee(destSelector, EVM2AnyMessage)` read-only to estimate cost
3. Approve token to Router
4. `ccipSend(destSelector, message)` with `value = feeWei`

### Example Prompts
```
"Bridge 5 USDC from Pharos to Ethereum via CCIP"
"Send 1 WPROS to Base using Chainlink"
"Bridge 10 USDC from Pharos to Ethereum with LI.FI"
"Fazer bridge de 5 USDC da Pharos para Ethereum"
```

### Real Test Result
- Input: 0.05 USDC on Pharos → Output: **+0.049376 USDC on Base**
- Bridge: Polymer (Fast) via CCTP — ETA ~10 seconds
- Pharos TX: [Pharosscan](https://www.pharosscan.xyz/tx/0x7569cf983212734d7e4ad25b17ea4f18b6c0f6a69b89129a58128b7d4b389089)

---

## Skill 3 — `pharos-add-liquidity`

**Trigger keywords:** add liquidity, provide liquidity, LP position, FaroSwap liquidity, V3 position, adicionar liquidez, fornecer liquidez

Adds concentrated liquidity to **FaroSwap V3** (Uniswap V3 fork) using the NonfungiblePositionManager. Returns a position NFT.

### Contracts

| Contract | Address |
|----------|---------|
| NonfungiblePositionManager | `0xc0479219f4feba5a668cff71bf96f4ffe124c3ab` |
| Factory | `0x2c90ccb0b989afa2433f499698451a25744a552b` |
| WPROS/USDC 0.01% Pool | `0x912c9ade24d44d8922f0866d8dcb079f1363f647` |

> WPROS (`0x52c4…`) < USDC (`0xc879…`) → WPROS is always **token0**, USDC is **token1**.

### Three Range Modes

| Mode | How it works |
|------|-------------|
| **A — Full Range** | `tickLower = -887272`, `tickUpper = 887272` (rounded to spacing) |
| **B — ±X% around current price** | Reads `slot0().sqrtPriceX96`, derives ±X% bounds via tick math |
| **C — Explicit price range** | User specifies min/max in USDC per WPROS |

### V3 Math (human-scale, avoids float cancellation)

```js
// Read pool price
const sqrtRatio  = Number(sqrtPriceX96) / 2**96;
const priceHuman = sqrtRatio * sqrtRatio * 1e12; // USDC per WPROS

// Tick bounds
const tickUpper = Math.floor(Math.log(priceHuman * 1.10 / 1e12) / Math.log(1.0001));
const tickLower = Math.ceil( Math.log(priceHuman * 0.90 / 1e12) / Math.log(1.0001));

// Amount of USDC for a given WPROS input
const L     = wpros * sqrtPh * sqrtPbh / (sqrtPbh - sqrtPh);
const usdcH = L * (sqrtPh - sqrtPah);
```

> Working in human-readable prices (USDC/WPROS) instead of raw contract units avoids catastrophic cancellation in the sqrt arithmetic at large negative ticks.

### Flow
1. Read `pool.slot0()` for current price and tick
2. Compute tick range and USDC amount for given WPROS
3. Check and send ERC20 approvals (exact amounts only)
4. `NPM.mint(MintParams)` — selector `0x88316456`
5. Decode `tokenId` from `IncreaseLiquidity` event in receipt
6. Call `NPM.positions(tokenId)` and display full position

### Example Prompts
```
"Add liquidity 0.01 WPROS to FaroSwap ±10% range, 0.01% fee"
"Provide liquidity WPROS/USDC full range"
"What's the current WPROS/USDC price on FaroSwap?"
"Adicionar liquidez 5 WPROS no FaroSwap range ±10%"
```

### Real Test Result
- Deposited: 0.01 WPROS + 0.006441 USDC
- **Position NFT #2854** — in-range, earning fees immediately
- Liquidity: 164,283,884,559
- Range: −282750 to −280744 (0.526 – 0.643 USDC/WPROS)
- [Pharosscan](https://www.pharosscan.xyz/tx/0xc00aaceeebeca9a97f95141464a28558b50923c36ab68d7d772dc07832db91ff)

---

## Security Model

Every skill and exec script follows these rules:

1. **Key isolation** — `PRIVATE_KEY` is read from a `.env` file (never hardcoded). `.env` is in `.gitignore`. Scripts fail immediately if the key is absent.
2. **Address verification** — `ethers.Wallet(pk).address` is checked against the expected wallet before any tx is built.
3. **Simulate before send** — Swap/bridge quotes are shown and confirmed before broadcasting. The agent never sends without user approval.
4. **Exact approvals** — ERC20 approvals use the exact `fromAmount`, never `uint256.max`.
5. **TX_TO whitelist** — Before sending a swap or bridge tx, the script verifies `transactionRequest.to == LI.FI Diamond`. Aborts if it differs.
6. **No private key logging** — The key is never printed, echoed, or included in log lines.

---

## Technical Discoveries

These were found during real testing and are documented in the SKILL.md files:

### CCIP: Pharos Router uses `EVMExtraArgsV1`
The Pharos CCIP Router (`0x4e52dD…`) rejects `GenericExtraArgsV2` (tag `0x059474c3`) with `InvalidExtraArgsTag()`. It uses the older **`EVMExtraArgsV1`** format:
```
tag  = keccak256("CCIP EVMExtraArgsV1")[:4]  →  0x97a657c9
body = abi.encode(uint256 gasLimit)           →  32 zero bytes (gasLimit=0 or 200000)
```
The `pharos-bridge/SKILL.md` documents this and uses the correct tag.

### FaroSwap V3: Verified Contract Addresses
- NPM: `0xc0479219f4feba5a668cff71bf96f4ffe124c3ab` — verified live (NFT #2854 minted)
- Main WPROS/USDC pool (0.01%, fee=100): `0x912c9ade24d44d8922f0866d8dcb079f1363f647`
- `mint` selector `0x88316456` matches standard Uniswap V3 NPM ABI

### LI.FI on Pharos: Polymer/CCTP Bridge
LI.FI routes Pharos→Base USDC through **Polymer (CCTP fast path)**, delivering in ~10 seconds vs. the standard 20-minute CCTP finality. Fee: ~1.25% (LI.FI fixed 0.25% + Polymer relay 1%).

### keccak256 in Pure JS (no native deps)
Node.js `crypto.createHash('keccak256')` fails — Node uses NIST SHA3 (0x06 padding), not Ethereum keccak (0x01 padding). `keccak256.js` in this repo implements the correct Ethereum keccak-256 from scratch using `Int32Array(50)` state, verified against known vectors:
- `keccak256("")` → `c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470` ✓
- `keccak256("test")` → `9c22ff5f21f0b81b113e63f7db6da94fedef11b2119b4088b89664fb9a3cb658` ✓

---

## Requirements

- [Claude Code](https://claude.ai/code) with the `pharos-skill-engine` plugin installed
- Node.js v18+ (for exec scripts)
- `ethers` v6 (`npm install` in this folder)

Foundry/`cast` is **not required** — the exec scripts use ethers.js and direct JSON-RPC.

---

## Installation

### Skills (for Claude Code agent use)
```bash
# Install the engine first
~/.claude/plugins/pharos-skill-engine/skills/pharos-skill-engine/SKILL.md

# Then install each skill
~/.claude/plugins/pharos-defi-skills/skills/pharos-swap/SKILL.md
~/.claude/plugins/pharos-defi-skills/skills/pharos-bridge/SKILL.md
~/.claude/plugins/pharos-defi-skills/skills/pharos-add-liquidity/SKILL.md
```

### Exec Scripts (for direct testing)
```bash
git clone https://github.com/YOUR_USERNAME/pharos-defi-skills
cd pharos-defi-skills
npm install
cp .env.example .env
# Edit .env: set PRIVATE_KEY=0x...

node swap_exec.js         # 0.1 PROS → USDC
node bridge_exec.js       # 0.05 USDC Pharos → Base
node liquidity_exec.js    # add 0.01 WPROS to FaroSwap V3
node check_base.js        # verify USDC arrival on Base
```

---

## Network Reference

| Network | chainId | RPC | Explorer |
|---------|---------|-----|----------|
| Pharos Mainnet | 1672 | `https://rpc.pharos.xyz` | [pharosscan.xyz](https://www.pharosscan.xyz) |
| Pharos Atlantic Testnet | 688689 | `https://atlantic.dplabs-internal.com` | [atlantic.pharosscan.xyz](https://atlantic.pharosscan.xyz) |

---

## Built With

- [pharos-skill-engine v0.1.0](https://github.com/pharos-network/pharos-skill-engine) — official Pharos agent skill framework
- [LI.FI API](https://li.fi) — swap and cross-chain bridge aggregator
- [Chainlink CCIP](https://chain.link/cross-chain) — trustless cross-chain token transfers
- [FaroSwap V3](https://faroswap.xyz) — Uniswap V3 fork on Pharos
- [ethers.js v6](https://docs.ethers.org/v6/) — Ethereum library for exec scripts
