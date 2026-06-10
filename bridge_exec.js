'use strict';
// bridge_exec.js — 0.05 USDC Pharos → Base via LI.FI (Polymer/CCTP)
// Reads PRIVATE_KEY from .env or env var; never logs it.

// Load .env (skipped if PRIVATE_KEY already set in environment)
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
const https = require('https');

const PHAROS_RPC   = 'https://rpc.pharos.xyz';
const BASE_RPC     = 'https://mainnet.base.org';
const PHAROS_CHAIN = 1672;
const BASE_CHAIN   = 8453;
const WALLET_ADDR  = '0x36944B925392cA6A9DC956628aa89F1AB1C8c997';
const DIAMOND      = '0xFf70F4A1d11995621854F3692acF286d8aCd04b2';
const USDC_PHAROS  = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const USDC_BASE    = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const FROM_AMOUNT  = '50000'; // 0.05 USDC (6 decimals)

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const pk = process.env.PRIVATE_KEY;
if (!pk) { console.error('ERROR: PRIVATE_KEY env var is not set'); process.exit(1); }

function fetchQuote() {
  return new Promise((resolve, reject) => {
    const url =
      'https://li.quest/v1/quote' +
      '?fromChain=' + PHAROS_CHAIN +
      '&toChain=' + BASE_CHAIN +
      '&fromToken=' + USDC_PHAROS +
      '&toToken=' + USDC_BASE +
      '&fromAmount=' + FROM_AMOUNT +
      '&fromAddress=' + WALLET_ADDR +
      '&slippage=0.005';
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const q = JSON.parse(d);
          if (!q.transactionRequest) {
            reject(new Error('LI.FI error: ' + JSON.stringify(q).slice(0, 300)));
          } else {
            resolve(q);
          }
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function pollBaseBalance(baseProvider, before, timeoutMs = 90000) {
  const usdcBase = new ethers.Contract(USDC_BASE, ERC20_ABI, baseProvider);
  const deadline = Date.now() + timeoutMs;
  process.stdout.write('Polling Base for USDC arrival');
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    process.stdout.write('.');
    try {
      const bal = await usdcBase.balanceOf(WALLET_ADDR);
      if (bal > before) { console.log(' arrived!'); return bal; }
    } catch (_) {}
  }
  console.log(' timed out after ' + (timeoutMs / 1000) + 's');
  return null;
}

async function main() {
  // ── Connect to Pharos ────────────────────────────────────────────────────
  const pharosProvider = new ethers.JsonRpcProvider(PHAROS_RPC, { chainId: PHAROS_CHAIN, name: 'pharos' });
  const wallet = new ethers.Wallet(pk, pharosProvider);

  if (wallet.address.toLowerCase() !== WALLET_ADDR.toLowerCase()) {
    console.error('ERROR: key derives to', wallet.address, '— expected', WALLET_ADDR);
    process.exit(1);
  }
  console.log('Wallet         : [hidden] → address verified ✓  (' + WALLET_ADDR + ')');

  // ── Snapshot balances ────────────────────────────────────────────────────
  const usdcPharos     = new ethers.Contract(USDC_PHAROS, ERC20_ABI, wallet);
  const baseProvider   = new ethers.JsonRpcProvider(BASE_RPC, { chainId: BASE_CHAIN, name: 'base' });
  const usdcBaseRO     = new ethers.Contract(USDC_BASE, ERC20_ABI, baseProvider);

  const [usdcPharosBefore, usdcBaseBefore] = await Promise.all([
    usdcPharos.balanceOf(WALLET_ADDR),
    usdcBaseRO.balanceOf(WALLET_ADDR),
  ]);
  console.log('USDC (Pharos)  :', ethers.formatUnits(usdcPharosBefore, 6), '(before)');
  console.log('USDC (Base)    :', ethers.formatUnits(usdcBaseBefore, 6), '(before)');

  if (usdcPharosBefore < BigInt(FROM_AMOUNT)) {
    console.error('ERROR: insufficient USDC — have', ethers.formatUnits(usdcPharosBefore, 6), 'need 0.05');
    process.exit(1);
  }

  // ── Fresh quote ───────────────────────────────────────────────────────────
  console.log('\nFetching fresh LI.FI bridge quote...');
  const quote = await fetchQuote();
  const tx    = quote.transactionRequest;

  // Security: TX_TO must be LI.FI Diamond
  if (tx.to.toLowerCase() !== DIAMOND.toLowerCase()) {
    console.error('SECURITY ABORT: TX_TO', tx.to, '!= LI.FI Diamond', DIAMOND);
    process.exit(1);
  }
  const approvalAddr = (quote.estimate.approvalAddress || DIAMOND).toLowerCase();
  if (approvalAddr !== DIAMOND.toLowerCase()) {
    console.error('SECURITY ABORT: approvalAddress', approvalAddr, '!= LI.FI Diamond');
    process.exit(1);
  }
  console.log('TX_TO          :', tx.to, ' ← LI.FI Diamond ✓');
  console.log('Bridge         :', quote.toolDetails.name);
  console.log('Receive        : ~' + ethers.formatUnits(BigInt(quote.estimate.toAmount), 6) + ' USDC on Base');

  // ── Step 1: ERC20 Allowance + Approval ────────────────────────────────────
  const currentAllowance = await usdcPharos.allowance(WALLET_ADDR, DIAMOND);
  console.log('\nAllowance to Diamond:', ethers.formatUnits(currentAllowance, 6), 'USDC');

  if (currentAllowance < BigInt(FROM_AMOUNT)) {
    console.log('Insufficient — sending approve tx...');
    const approveTx = await usdcPharos.approve(DIAMOND, BigInt(FROM_AMOUNT));
    console.log('Approve hash   :', approveTx.hash);
    console.log('Pharosscan     : https://www.pharosscan.xyz/tx/' + approveTx.hash);
    process.stdout.write('Waiting for approval confirmation...');
    const approveReceipt = await approveTx.wait(1);
    if (approveReceipt.status !== 1) {
      console.error('\nApprove tx REVERTED ✗'); process.exit(1);
    }
    console.log(' CONFIRMED ✓  (block ' + approveReceipt.blockNumber + ')');
  } else {
    console.log('Allowance sufficient — skipping approve');
  }

  // ── Step 2: Bridge transaction ─────────────────────────────────────────────
  console.log('\nSending bridge tx...');
  const bridgeTxResp = await wallet.sendTransaction({
    to:       tx.to,
    data:     tx.data,
    value:    BigInt(tx.value),
    gasLimit: BigInt(tx.gasLimit) * 110n / 100n,
    gasPrice: BigInt(tx.gasPrice),
    chainId:  PHAROS_CHAIN,
  });

  console.log('');
  console.log('Bridge TX      : ' + bridgeTxResp.hash);
  console.log('Pharosscan     : https://www.pharosscan.xyz/tx/' + bridgeTxResp.hash);
  process.stdout.write('Waiting for Pharos confirmation...');

  const bridgeReceipt = await bridgeTxResp.wait(1);
  if (bridgeReceipt.status !== 1) {
    console.error('\nBridge tx REVERTED ✗'); process.exit(1);
  }
  console.log(' CONFIRMED ✓  (block ' + bridgeReceipt.blockNumber + ', gas: ' + bridgeReceipt.gasUsed + ')');

  const usdcPharosAfter = await usdcPharos.balanceOf(WALLET_ADDR);
  console.log('USDC (Pharos) after:', ethers.formatUnits(usdcPharosAfter, 6));

  // ── Step 3: Poll Base for arrival (~10s ETA via Polymer) ─────────────────
  console.log('\nWaiting for USDC to appear on Base (ETA ~10s, timeout 90s)...');
  const usdcBaseAfter = await pollBaseBalance(baseProvider, usdcBaseBefore);

  // ── Summary ───────────────────────────────────────────────────────────────
  const arrived = usdcBaseAfter !== null;
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  BRIDGE ' + (arrived ? 'COMPLETE ✓' : 'TX SENT (poll timed out)'));
  console.log('  Source TX    : ' + bridgeTxResp.hash);
  console.log('  Explorer     : https://www.pharosscan.xyz/tx/' + bridgeTxResp.hash);
  console.log('  USDC Pharos  : ' + ethers.formatUnits(usdcPharosBefore, 6) + ' → ' + ethers.formatUnits(usdcPharosAfter, 6));
  if (arrived) {
    console.log('  USDC Base    : ' + ethers.formatUnits(usdcBaseBefore, 6) + ' → ' + ethers.formatUnits(usdcBaseAfter, 6));
    console.log('  Arrived      : +' + ethers.formatUnits(usdcBaseAfter - usdcBaseBefore, 6) + ' USDC');
  } else {
    console.log('  USDC Base    : check manually with:');
    console.log('    PRIVATE_KEY=... node check_base.js');
  }
  console.log('══════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('\nFatal:', err.message || err);
  process.exit(1);
});
