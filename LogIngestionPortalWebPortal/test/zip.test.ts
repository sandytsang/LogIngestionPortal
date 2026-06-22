import { describe, expect, it } from 'vitest';
import { createZip } from '../src/lib/zip';

/** Reads the first STORE entry's stored size and raw data bytes from a zip Blob. */
async function firstEntry(bytes: Uint8Array): Promise<{ size: number; data: Uint8Array }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(22, true); // uncompressed size in the local header
  const nameLen = view.getUint16(26, true);
  const start = 30 + nameLen;
  return { size, data: bytes.slice(start, start + size) };
}

describe('createZip', () => {
  it('writes .ps1 entries as UTF-8 with a BOM so signed scripts hash consistently', async () => {
    const content = "Write-Output 'hi'";
    const blob = createZip([{ name: 'IntuneScript.ps1', content }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { size, data } = await firstEntry(bytes);

    expect(data[0]).toBe(0xef);
    expect(data[1]).toBe(0xbb);
    expect(data[2]).toBe(0xbf);
    // Stored size is the content bytes plus the 3-byte BOM.
    expect(size).toBe(new TextEncoder().encode(content).length + 3);
  });

  it('does not add a BOM to non-.ps1 entries', async () => {
    const content = '{"a":1}';
    const blob = createZip([{ name: 'columns.json', content }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { size, data } = await firstEntry(bytes);

    expect(data[0]).not.toBe(0xef);
    expect(size).toBe(new TextEncoder().encode(content).length);
  });
});
