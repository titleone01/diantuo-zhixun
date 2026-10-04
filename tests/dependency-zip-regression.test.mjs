import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('patched fflate rejects a missing ZIP64 extra field without hanging and keeps valid ZIPs readable', () => {
  // GHSA-px8p-9vwx-vf98: a ZIP64 size sentinel without its required extra field.
  // Keep parsing in a bounded child so a future vulnerable resolution cannot hang the suite.
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { unzipSync, zipSync } from 'fflate';
    const source = new Uint8Array([1, 2, 3]);
    assert.deepEqual(unzipSync(zipSync({ 'training.txt': source }))['training.txt'], source);
    const bytes = Buffer.alloc(145);
    bytes.writeUInt32LE(0x02014b50, 0); // Central directory with no ZIP64 extra field.
    bytes.writeUInt32LE(0xffffffff, 20); bytes.writeUInt16LE(1, 28); bytes[46] = 120;
    bytes.writeUInt32LE(0x06064b50, 47); bytes.writeBigUInt64LE(44n, 51);
    bytes.writeBigUInt64LE(1n, 71); bytes.writeBigUInt64LE(1n, 79);
    bytes.writeBigUInt64LE(47n, 87); bytes.writeBigUInt64LE(0n, 95);
    bytes.writeUInt32LE(0x07064b50, 103); bytes.writeBigUInt64LE(47n, 111);
    bytes.writeUInt32LE(0x06054b50, 123); bytes.writeUInt16LE(65535, 131);
    bytes.writeUInt16LE(65535, 133); bytes.writeUInt32LE(0xffffffff, 139);
    assert.throws(() => unzipSync(bytes), error => error.code === 13);
  `], { cwd: process.cwd(), encoding: 'utf8', timeout: 3000, windowsHide: true });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
});
