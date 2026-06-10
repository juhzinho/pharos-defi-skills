'use strict';
// check_base.js — check USDC balance on Base for the test wallet
// (no key needed for this read-only script, but loads .env for consistency)
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

const BASE_RPC  = 'https://mainnet.base.org';
const WALLET    = '0x36944B925392cA6A9DC956628aa89F1AB1C8c997';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

async function main() {
  const provider = new ethers.JsonRpcProvider(BASE_RPC, { chainId: 8453, name: 'base' });
  const usdc = new ethers.Contract(USDC_BASE, ['function balanceOf(address) view returns (uint256)'], provider);
  const bal = await usdc.balanceOf(WALLET);
  console.log('USDC on Base:', ethers.formatUnits(bal, 6), 'USDC');
  console.log('Wallet      :', WALLET);
  console.log('Basescan    : https://basescan.org/token/' + USDC_BASE + '?a=' + WALLET);
}
main().catch(console.error);
