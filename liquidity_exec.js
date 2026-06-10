'use strict';
// liquidity_exec.js — Add 0.01 WPROS + matching USDC to FaroSwap V3 WPROS/USDC 0.01% pool
// Reads PRIVATE_KEY from .env; never logs it.

const fs = require('fs'), path = require('path');
if (!process.env.PRIVATE_KEY) {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m) process.env[m[1]] = m[2].trim();
    });
  }
}

const { ethers } = require('./node_modules/ethers');

const RPC        = 'https://rpc.pharos.xyz';
const CHAIN_ID   = 1672;
const WALLET     = '0x36944B925392cA6A9DC956628aa89F1AB1C8c997';
const WPROS_ADDR = '0x52c48d4213107b20bc583832b0d951fb9ca8f0b0';
const USDC_ADDR  = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const POOL_ADDR  = '0x912c9ade24d44d8922f0866d8dcb079f1363f647';
const NPM_ADDR   = '0xc0479219f4feba5a668cff71bf96f4ffe124c3ab';
const FEE        = 100;   // 0.01%
const SPACING    = 1;

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
];
const NPM_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
];

const pk = process.env.PRIVATE_KEY;
if (!pk) { console.error('ERROR: PRIVATE_KEY not set'); process.exit(1); }

// ── ERC20 approval helper ─────────────────────────────────────────────────
async function ensureApproval(token, spender, amount, symbol, decimals) {
  const current = await token.allowance(WALLET, spender);
  if (current >= amount) {
    console.log(symbol + ' allowance: ' + ethers.formatUnits(current, decimals) + ' — sufficient, skip');
    return;
  }
  console.log(symbol + ' allowance: ' + ethers.formatUnits(current, decimals) + ' < needed ' + ethers.formatUnits(amount, decimals) + ' — approving...');
  const tx = await token.approve(spender, amount);
  console.log('  Approve hash : ' + tx.hash);
  console.log('  Pharosscan   : https://www.pharosscan.xyz/tx/' + tx.hash);
  process.stdout.write('  Waiting...');
  const receipt = await tx.wait(1);
  if (receipt.status !== 1) { console.error('\n  Approve REVERTED ✗'); process.exit(1); }
  console.log(' confirmed ✓  (block ' + receipt.blockNumber + ')');
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'pharos' });
  const signer   = new ethers.Wallet(pk, provider);

  if (signer.address.toLowerCase() !== WALLET.toLowerCase()) {
    console.error('ERROR: key derives to ' + signer.address + ' — expected ' + WALLET);
    process.exit(1);
  }
  console.log('Wallet : [hidden] → ' + WALLET + ' ✓');

  const wpros = new ethers.Contract(WPROS_ADDR, ERC20_ABI, signer);
  const usdc  = new ethers.Contract(USDC_ADDR,  ERC20_ABI, signer);
  const pool  = new ethers.Contract(POOL_ADDR,  POOL_ABI,  provider);
  const npm   = new ethers.Contract(NPM_ADDR,   NPM_ABI,   signer);

  // ── Balances + fresh slot0 ─────────────────────────────────────────────
  const [wBal, uBal, slot0] = await Promise.all([
    wpros.balanceOf(WALLET), usdc.balanceOf(WALLET), pool.slot0(),
  ]);
  const currentTick  = Number(slot0.tick);
  const sqrtRatio    = Number(slot0.sqrtPriceX96) / 2 ** 96;
  const priceHuman   = sqrtRatio * sqrtRatio * 1e12; // USDC per WPROS

  console.log('WPROS balance : ' + ethers.formatEther(wBal));
  console.log('USDC  balance : ' + ethers.formatUnits(uBal, 6));
  console.log('Pool price    : ' + priceHuman.toFixed(6) + ' USDC/WPROS  (tick ' + currentTick + ')');

  // ── Tick range ±10% around current price ──────────────────────────────
  const tickUpper = Math.floor(Math.log(priceHuman * 1.10 / 1e12) / Math.log(1.0001) / SPACING) * SPACING;
  const tickLower = Math.ceil( Math.log(priceHuman * 0.90 / 1e12) / Math.log(1.0001) / SPACING) * SPACING;

  if (!(tickLower < currentTick && currentTick < tickUpper)) {
    console.error('ERROR: tick ' + currentTick + ' not in [' + tickLower + ', ' + tickUpper + '] — price may have moved drastically');
    process.exit(1);
  }

  const priceAtLower = (1.0001 ** tickLower) * 1e12;
  const priceAtUpper = (1.0001 ** tickUpper) * 1e12;
  console.log('tickLower     : ' + tickLower + '  (' + priceAtLower.toFixed(6) + ' USDC/WPROS)');
  console.log('tickUpper     : ' + tickUpper + '  (' + priceAtUpper.toFixed(6) + ' USDC/WPROS)');

  // ── V3 liquidity math (human prices — avoids float cancellation) ───────
  const sqrtPh  = Math.sqrt(priceHuman);
  const sqrtPah = Math.sqrt(priceAtLower);
  const sqrtPbh = Math.sqrt(priceAtUpper);
  const wprosH  = 0.01;
  const L       = wprosH * sqrtPh * sqrtPbh / (sqrtPbh - sqrtPh);
  const usdcH   = L * (sqrtPh - sqrtPah);

  const wprosWei = BigInt(Math.round(wprosH * 1e18));
  const usdcRaw  = BigInt(Math.round(usdcH  * 1e6));
  const wprosMin = wprosWei * 99n / 100n;
  const usdcMin  = usdcRaw  * 99n / 100n;

  console.log('WPROS desired : ' + ethers.formatEther(wprosWei)    + '  (' + wprosWei.toString() + ' wei)');
  console.log('USDC  desired : ' + ethers.formatUnits(usdcRaw, 6) + '  (' + usdcRaw.toString()  + ' raw)');

  if (wBal < wprosWei) { console.error('Insufficient WPROS: have ' + ethers.formatEther(wBal)); process.exit(1); }
  if (uBal < usdcRaw)  { console.error('Insufficient USDC: have '  + ethers.formatUnits(uBal, 6)); process.exit(1); }

  // ── Approvals ──────────────────────────────────────────────────────────
  console.log('');
  await ensureApproval(wpros, NPM_ADDR, wprosWei, 'WPROS', 18);
  await ensureApproval(usdc,  NPM_ADDR, usdcRaw,  'USDC',  6);

  // ── Mint ───────────────────────────────────────────────────────────────
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  console.log('\nMinting LP position...');

  const mintTx = await npm.mint(
    {
      token0:         WPROS_ADDR,
      token1:         USDC_ADDR,
      fee:            FEE,
      tickLower:      tickLower,
      tickUpper:      tickUpper,
      amount0Desired: wprosWei,
      amount1Desired: usdcRaw,
      amount0Min:     wprosMin,
      amount1Min:     usdcMin,
      recipient:      WALLET,
      deadline:       deadline,
    },
    { gasLimit: 600000n }
  );

  console.log('Mint hash  : ' + mintTx.hash);
  console.log('Pharosscan : https://www.pharosscan.xyz/tx/' + mintTx.hash);
  process.stdout.write('Waiting for confirmation...');
  const receipt = await mintTx.wait(1);
  if (receipt.status !== 1) { console.error('\nMint REVERTED ✗'); process.exit(1); }
  console.log(' CONFIRMED ✓  (block ' + receipt.blockNumber + ', gas: ' + receipt.gasUsed.toString() + ')');

  // ── Extract tokenId from IncreaseLiquidity event ───────────────────────
  let tokenId = null, mintedLiq = null, amt0 = null, amt1 = null;
  for (const log of receipt.logs) {
    try {
      const parsed = npm.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === 'IncreaseLiquidity') {
        tokenId   = parsed.args.tokenId;
        mintedLiq = parsed.args.liquidity;
        amt0      = parsed.args.amount0;
        amt1      = parsed.args.amount1;
        break;
      }
    } catch (_) {}
  }
  if (tokenId === null) {
    // Fallback via ERC721Enumerable
    const count = await npm.balanceOf(WALLET);
    tokenId = await npm.tokenOfOwnerByIndex(WALLET, count - 1n);
    console.log('(tokenId via enumerable fallback)');
  }

  // ── Read on-chain position ─────────────────────────────────────────────
  console.log('\nReading position ' + tokenId.toString() + ' from NPM...');
  const [pos, latestTick] = await Promise.all([
    npm.positions(tokenId),
    pool.slot0().then(s => Number(s.tick)),
  ]);
  const inRange = Number(pos.tickLower) <= latestTick && latestTick < Number(pos.tickUpper);

  // ── Final summary ──────────────────────────────────────────────────────
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  POSITION MINTED ✓');
  console.log('  Token ID      : ' + tokenId.toString());
  console.log('  NFT link      : https://www.pharosscan.xyz/token/' + NPM_ADDR + '?a=' + tokenId.toString());
  console.log('  Mint TX       : https://www.pharosscan.xyz/tx/' + mintTx.hash);
  console.log('  ───────────────────────────────────────────────────');
  console.log('  Pool          : WPROS/USDC  fee 0.01% (100)');
  console.log('  tickLower     : ' + pos.tickLower.toString() + '  (' + ((1.0001 ** Number(pos.tickLower)) * 1e12).toFixed(6) + ' USDC/WPROS)');
  console.log('  tickUpper     : ' + pos.tickUpper.toString() + '  (' + ((1.0001 ** Number(pos.tickUpper)) * 1e12).toFixed(6) + ' USDC/WPROS)');
  console.log('  Liquidity     : ' + pos.liquidity.toString());
  if (amt0 !== null) {
    console.log('  WPROS deposited: ' + ethers.formatEther(amt0));
    console.log('  USDC  deposited: ' + ethers.formatUnits(amt1, 6));
  }
  console.log('  Current tick  : ' + latestTick + '  → in-range: ' + (inRange ? 'YES ✓  (earning fees)' : 'NO ✗'));
  console.log('  Fees owed     : ' + pos.tokensOwed0.toString() + ' WPROS wei, ' + pos.tokensOwed1.toString() + ' USDC raw');
  console.log('══════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('\nFatal:', err.message || err);
  process.exit(1);
});
