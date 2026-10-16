import type { CircuitDocument } from './core/types';

/** Keep client IDs cryptographically random on older Chromium browsers. */
export function installBrowserRuntime() {
  if (typeof Array.prototype.at !== 'function') Object.defineProperty(Array.prototype, 'at', {
    configurable: true, writable: true,
    value: function at<T>(this: ArrayLike<T> | null | undefined, index: number) {
      if (this == null) throw new TypeError('Array.at requires an array-like value');
      const source = Object(this) as ArrayLike<T>;
      const length = Math.min(Math.max(Math.floor(Number(source.length) || 0), 0), Number.MAX_SAFE_INTEGER);
      const number = Number(index) || 0;
      const offset = number < 0 ? Math.ceil(number) : Math.floor(number);
      const position = offset < 0 ? length + offset : offset;
      return position < 0 || position >= length ? undefined : source[position];
    },
  });
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID !== 'function' && typeof source.getRandomValues === 'function') {
    Object.defineProperty(source, 'randomUUID', { configurable: true, writable: true, value: () => {
      const bytes = source.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } });
  }
}

/** Documents use the shared JSON schema; do not polyfill structuredClone for unrelated objects. */
export function cloneCircuitDocument(document: CircuitDocument): CircuitDocument {
  return typeof globalThis.structuredClone === 'function' ? globalThis.structuredClone(document) : JSON.parse(JSON.stringify(document)) as CircuitDocument;
}

installBrowserRuntime();
