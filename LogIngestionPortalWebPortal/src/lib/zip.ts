// Minimal, dependency-free ZIP writer (STORE method, no compression).
// Bundles a few small text files into a single .zip entirely in the browser —
// keeping the portal's "no backend, no dependencies" guarantee.

export interface ZipEntry {
  name: string;
  content: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Prepends the UTF-8 byte-order mark (EF BB BF) to already-encoded bytes. */
function withUtf8Bom(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 3);
  out[0] = 0xef;
  out[1] = 0xbb;
  out[2] = 0xbf;
  out.set(bytes, 3);
  return out;
}

/** Builds a ZIP archive (STORE/no-compression) as a Blob. */
export function createZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const fileParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    // PowerShell scripts are written as UTF-8 with a BOM. Intune-signed
    // remediation scripts are hashed byte-for-byte; emitting the same encoding
    // the signing tool expects keeps the on-disk bytes (and therefore the
    // Authenticode hash) stable after the script is re-saved and signed.
    const dataBytes = entry.name.toLowerCase().endsWith('.ps1')
      ? withUtf8Bom(encoder.encode(entry.content))
      : encoder.encode(entry.content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header.
    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true); // signature
    localHeader.setUint16(4, 20, true); // version needed
    localHeader.setUint16(6, 0x0800, true); // flags: UTF-8 names
    localHeader.setUint16(8, 0, true); // method: store
    localHeader.setUint16(10, 0, true); // mod time
    localHeader.setUint16(12, 0x21, true); // mod date (1980-01-01)
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, size, true); // compressed size
    localHeader.setUint32(22, size, true); // uncompressed size
    localHeader.setUint16(26, nameBytes.length, true);
    localHeader.setUint16(28, 0, true); // extra length

    fileParts.push(new Uint8Array(localHeader.buffer), nameBytes, dataBytes);

    // Central directory header.
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); // signature
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed
    central.setUint16(8, 0x0800, true); // flags: UTF-8 names
    central.setUint16(10, 0, true); // method: store
    central.setUint16(12, 0, true); // mod time
    central.setUint16(14, 0x21, true); // mod date
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true); // compressed size
    central.setUint32(24, size, true); // uncompressed size
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true); // extra length
    central.setUint16(32, 0, true); // comment length
    central.setUint16(34, 0, true); // disk number
    central.setUint16(36, 0, true); // internal attrs
    central.setUint32(38, 0, true); // external attrs
    central.setUint32(42, offset, true); // local header offset

    centralParts.push(new Uint8Array(central.buffer), nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);

  // End of central directory record.
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // signature
  end.setUint16(4, 0, true); // disk number
  end.setUint16(6, 0, true); // central dir disk
  end.setUint16(8, entries.length, true); // entries on this disk
  end.setUint16(10, entries.length, true); // total entries
  end.setUint32(12, centralSize, true); // central dir size
  end.setUint32(16, offset, true); // central dir offset
  end.setUint16(20, 0, true); // comment length

  return new Blob([...fileParts, ...centralParts, new Uint8Array(end.buffer)] as BlobPart[], {
    type: 'application/zip',
  });
}

/** Triggers a client-side download of a Blob. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
