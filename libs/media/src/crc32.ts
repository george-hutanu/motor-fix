// CRC-32 (IEEE 802.3, the one zlib and S3's x-amz-checksum-crc32 use).
const TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// The value S3 compares with the body: base64 of the big-endian checksum.
export async function crc32Base64(file: Blob): Promise<string> {
  const sum = crc32(new Uint8Array(await file.arrayBuffer()));
  const bytes = [
    sum >>> 24,
    (sum >>> 16) & 0xff,
    (sum >>> 8) & 0xff,
    sum & 0xff,
  ];
  return btoa(String.fromCharCode(...bytes));
}
