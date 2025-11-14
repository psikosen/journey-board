import JSZip from 'jszip';

export class ZipExporter {
  constructor() {
    this.zip = new JSZip();
    this.manifest = new Map();
  }

  addFile(path, content) {
    const normalized = path.replace(/\\/g, '/');
    const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    this.zip.file(normalized, data);
    const hash = hashString(data);
    this.manifest.set(normalized, hash);
  }

  async finalize(options = {}) {
    const manifestLines = ['# Hash Manifest'];
    for (const [path, hash] of this.manifest.entries()) {
      manifestLines.push(`${hash}  ${path}`);
    }
    this.zip.file('manifest.txt', manifestLines.join('\n'));
    return this.zip.generateAsync({ type: options.type ?? 'uint8array', compression: 'DEFLATE' });
  }
}

function hashString(value) {
  let hash = 0x811c9dc5;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

