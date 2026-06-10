'use strict';
// swap_exec.js — 0.1 PROS → USDC on Pharos mainnet via LI.FI
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

const RPC_URL     = 'https://rpc.pharos.xyz';
const CHAIN_ID    = 1672;
const WALLET_ADDR = '0x36944B925392cA6A9DC956628aa89F1AB1C8c997';
const DIAMOND     = '0xFf70F4A1d11995621854F3692acF286d8aCd04b2';
const USDC_ADDR   = '0xc879c018db60520f4355c26ed1a6d572cdac1815';
const FROM_AMOUNT = '100000000000000000'; // 0.1 PROS (18 dec)

const pk = process.env.PRIVATE_KEY;
if (!pk) { console.error('ERROR: PRIVATE_KEY env var is not set'); process.exit(1); }

function fetchQuote() {
  return new Promise((resolve, reject) => {
    const url =
      'https://li.quest/v1/quote' +
      '?fromChain=1672&toChain=1672' +
      '&fromToken=0x0000000000000000000000000000000000000000' +
      '&toToken=' + USDC_ADDR +
      '&fromAmount=' + FROM_AMOUNT +
      '&fromAddress=' + WALLET_ADDR +
      '&slippage=0.01';
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const q = JSON.parse(d);
        if (!q.transactionRequest) {
          const detail = q.message || q.code || JSON.stringify(q).slice(0, 120);
          reject(new Error('No route found for this pair/amount - try a different amount (' + detail + ')'));
        } else {
          resolve(q);
        }
      });
    }).on('error', reject);
  });
}

async function balanceOf(contract, address, provider) {
  const iface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
  const data = iface.encodeFunctionData('balanceOf', [address]);
  const res = await provider.call({ to: contract, data });
  return BigInt(res);
}

async function main() {
  // ── Connect ──────────────────────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: CHAIN_ID, name: 'pharos' });
  const wallet   = new ethers.Wallet(pk, provider);

  if (wallet.address.toLowerCase() !== WALLET_ADDR.toLowerCase()) {
    console.error('ERROR: key derives to', wallet.address, '— expected', WALLET_ADDR);
    process.exit(1);
  }
  console.log('Wallet  : [hidden] → address verified ✓  (' + WALLET_ADDR + ')');

  // ── Balances before ───────────────────────────────────────────────────────
  const prosBefore = await provider.getBalance(WALLET_ADDR);
  const usdcBefore = await balanceOf(USDC_ADDR, WALLET_ADDR, provider);
  console.log('PROS    :', ethers.formatEther(prosBefore), 'PROS  (before)');
  console.log('USDC    :', ethers.formatUnits(usdcBefore, 6), 'USDC  (before)');

  // ── Fresh quote ───────────────────────────────────────────────────────────
  console.log('\nFetching fresh LI.FI quote...');
  const quote = await fetchQuote();
  const tx    = quote.transactionRequest;

  // Security: TX_TO must be LI.FI Diamond
  if (tx.to.toLowerCase() !== DIAMOND.toLowerCase()) {
    console.error('SECURITY ABORT: TX_TO', tx.to, '!= LI.FI Diamond', DIAMOND);
    process.exit(1);
  }
  console.log('TX_TO   :', tx.to, '  ← LI.FI Diamond ✓');
  console.log('Receive : ~' + (Number(quote.estimate.toAmount) / 1e6).toFixed(6) + ' USDC');
  console.log('Min out :', (Number(quote.estimate.toAmountMin) / 1e6).toFixed(6), 'USDC  (1% slippage)');
  console.log('Value   :', ethers.formatEther(BigInt(tx.value)), 'PROS  (sent as msg.value)');

  // ── Send ──────────────────────────────────────────────────────────────────
  console.log('\nSigning and broadcasting...');
  const txResp = await wallet.sendTransaction({
    to:       tx.to,
    data:     tx.data,
    value:    BigInt(tx.value),
    gasLimit: BigInt(tx.gasLimit) * 110n / 100n, // +10% buffer
    gasPrice: BigInt(tx.gasPrice),
    chainId:  CHAIN_ID,
  });

  console.log('');
  console.log('TX hash : ' + txResp.hash);
  console.log('Phaross : https://www.pharosscan.xyz/tx/' + txResp.hash);
  console.log('');
  console.log('Waiting for confirmation (this may take 10-30s)...');

  const receipt = await txResp.wait(1);

  if (receipt.status !== 1) {
    console.error('REVERTED ✗  — receipt status:', receipt.status);
    process.exit(1);
  }

  // ── Balances after ────────────────────────────────────────────────────────
  const usdcAfter = await balanceOf(USDC_ADDR, WALLET_ADDR, provider);
  const gained    = usdcAfter - usdcBefore;

  console.log('');
  console.log('══════════════════════════════════════════');
  console.log('  SWAP CONFIRMED ✓');
  console.log('  Block    :', receipt.blockNumber);
  console.log('  Gas used :', receipt.gasUsed.toString());
  console.log('  USDC before :', ethers.formatUnits(usdcBefore, 6));
  console.log('  USDC after  :', ethers.formatUnits(usdcAfter, 6));
  console.log('  USDC gained : +' + ethers.formatUnits(gained, 6));
  console.log('  TX hash  :', txResp.hash);
  console.log('  Explorer : https://www.pharosscan.xyz/tx/' + txResp.hash);
  console.log('══════════════════════════════════════════');
}

main().catch(err => {
  console.error('\nFatal:', err.message || err);
  process.exit(1);
});
