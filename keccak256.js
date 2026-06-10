// Pure-JS keccak-256 (Ethereum padding: 0x01, not SHA3's 0x06)
// Reference: https://keccak.team/keccak_specs_summary.html

// Round constants — 24 rounds, stored as [lo32, hi32] little-endian
const RC = [
  [0x00000001,0x00000000],[0x00008082,0x00000000],[0x0000808a,0x80000000],[0x80008000,0x80000000],
  [0x0000808b,0x00000000],[0x80000001,0x00000000],[0x80008081,0x80000000],[0x00008009,0x80000000],
  [0x0000008a,0x00000000],[0x00000088,0x00000000],[0x80008009,0x00000000],[0x8000000a,0x00000000],
  [0x8000808b,0x00000000],[0x0000008b,0x80000000],[0x00008089,0x80000000],[0x00008003,0x80000000],
  [0x00008002,0x80000000],[0x00000080,0x80000000],[0x0000800a,0x00000000],[0x8000000a,0x80000000],
  [0x80008081,0x80000000],[0x00008080,0x80000000],[0x80000001,0x00000000],[0x80008008,0x80000000]
];

// Rotation offsets: ROTC[x + 5*y]
const ROTC = [
   0, 1,62,28,27,
  36,44, 6,55,20,
   3,10,43,25,39,
  41,45,15,21, 8,
  18, 2,61,56,14
];

function rotl64(lo, hi, n) {
  if (n === 0) return [lo, hi];
  if (n < 32) return [((lo << n) | (hi >>> (32 - n))) | 0, ((hi << n) | (lo >>> (32 - n))) | 0];
  n -= 32;
  if (n === 0) return [hi, lo];
  return [((hi << n) | (lo >>> (32 - n))) | 0, ((lo << n) | (hi >>> (32 - n))) | 0];
}

function keccakF(s) {
  const C = new Int32Array(10), B = new Int32Array(50);
  for (let round = 0; round < 24; round++) {
    // θ
    for (let x = 0; x < 5; x++) {
      C[2*x]   = s[2*x]   ^ s[2*(x+5)]   ^ s[2*(x+10)]   ^ s[2*(x+15)]   ^ s[2*(x+20)];
      C[2*x+1] = s[2*x+1] ^ s[2*(x+5)+1] ^ s[2*(x+10)+1] ^ s[2*(x+15)+1] ^ s[2*(x+20)+1];
    }
    for (let x = 0; x < 5; x++) {
      const [dl, dh] = rotl64(C[2*((x+1)%5)], C[2*((x+1)%5)+1], 1);
      const D0 = C[2*((x+4)%5)] ^ dl, D1 = C[2*((x+4)%5)+1] ^ dh;
      for (let y = 0; y < 5; y++) { s[2*(x+5*y)] ^= D0; s[2*(x+5*y)+1] ^= D1; }
    }
    // ρ + π
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const [bl, bh] = rotl64(s[2*(x+5*y)], s[2*(x+5*y)+1], ROTC[x+5*y]);
        const nx = y, ny = (2*x + 3*y) % 5;
        B[2*(nx+5*ny)] = bl; B[2*(nx+5*ny)+1] = bh;
      }
    }
    // χ
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const i = 2*(x+5*y), i1 = 2*((x+1)%5+5*y), i2 = 2*((x+2)%5+5*y);
        s[i]   = B[i]   ^ (~B[i1]   & B[i2]);
        s[i+1] = B[i+1] ^ (~B[i1+1] & B[i2+1]);
      }
    }
    // ι
    s[0] ^= RC[round][0]; s[1] ^= RC[round][1];
  }
}

function keccak256(message) {
  const msg = typeof message === 'string' ? Buffer.from(message, 'utf8') : Buffer.from(message);
  const r = 136; // rate for keccak-256 = (1600-512)/8
  const padLen = Math.ceil((msg.length + 1) / r) * r;
  const padded = new Uint8Array(padLen);
  padded.set(msg);
  padded[msg.length] ^= 0x01;       // Keccak (not SHA3 which uses 0x06)
  padded[padLen - 1] ^= 0x80;
  const s = new Int32Array(50);
  for (let off = 0; off < padLen; off += r) {
    for (let i = 0; i < r; i += 8) {
      const j = off + i;
      s[i/4]   ^= (padded[j] | (padded[j+1]<<8) | (padded[j+2]<<16) | (padded[j+3]<<24)) | 0;
      s[i/4+1] ^= (padded[j+4] | (padded[j+5]<<8) | (padded[j+6]<<16) | (padded[j+7]<<24)) | 0;
    }
    keccakF(s);
  }
  let hex = '';
  for (let i = 0; i < 32; i++) hex += ((s[i>>2] >>> ((i&3)*8)) & 0xff).toString(16).padStart(2,'0');
  return hex;
}

module.exports = keccak256;
