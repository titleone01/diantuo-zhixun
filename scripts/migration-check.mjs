import { access, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { activateRelease, checkReleaseCompatibility, inventory, verifyArchive } from './release-tools.mjs';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--rebase') || args.length > 1) throw new Error('Usage: migration-check.mjs [--rebase]');
const runtime = join(root, '.wrangler');
try {
  const pointer = JSON.parse(await readFile(join(runtime, 'active-release.json'), 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(pointer.releaseId)) throw new Error('发布标识无效。');
  const release = join(root, '.local', 'releases', pointer.releaseId);
  const manifest = await verifyArchive(release, 'release');
  if (manifest.id !== pointer.releaseId) throw new Error('随项目保存的正式版本不匹配。');
  for (const file of ['node_modules/wrangler/bin/wrangler.js', '.wrangler/state', '.wrangler/.dev.vars', '.wrangler/base-config.json', '.local/windows-launcher.json']) await access(join(root, file));
  const state = join(runtime, 'state');
  const databaseFiles = Object.keys(await inventory(state)).filter(name => /\.(sqlite|sqlite3|db)$/.test(name));
  if (!databaseFiles.length) throw new Error('缺少已保存的数据库。');
  for (const file of databaseFiles) {
    const db = new DatabaseSync(join(state, file), { readOnly: true });
    try {
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('数据库完整性检查未通过。');
    } finally { db.close(); }
  }
  await checkReleaseCompatibility(release, state, manifest);
  const rebasingNeeded = pointer.release !== release || pointer.state !== join(runtime, 'state');
  if (args.includes('--rebase')) {
    await activateRelease(release, runtime, { stopped: true, origin: 'http://127.0.0.1:3000', leaseFile: join(runtime, 'runtime-lease.json') });
    console.log('已通过停写与数据兼容检查，更新当前副本的运行路径；未迁移或重置数据库。');
  } else if (rebasingNeeded) {
    console.log('项目已换位置。请先确保原电脑服务已停止，再运行迁移菜单的“修复路径”。');
    process.exitCode = 2;
  }
  console.log(`正式版本完整性通过：${manifest.id.slice(0, 12)}，${Object.keys(manifest.files).length} 个文件。`);
  console.log('数据库完整性和草稿/作品兼容性通过；运行依赖与私有配置入口均已找到。附件完整性以关键备份的逐文件校验和实际打开结果为准。');
  console.log('跨电脑时，公网连接器的 Windows DPAPI 凭据需在目标账户重新接入；复制文件不能证明公网可用。');
  console.log('迁移后运行 scripts/install-desktop-shortcut.ps1 重建桌面与同级启动入口。原浏览器未保存草稿需另行导出。');
} catch (error) {
  console.error(`迁移检查未完成：${error.code || error.name}。请保留当前数据，检查版本、依赖和私有配置是否齐全。`);
  process.exitCode = 1;
}
