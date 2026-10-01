import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith("--")) throw new Error(`${name} 需要参数`);
  return process.argv[index + 1];
}
const directoryArgument = option("--directory");
if (!directoryArgument) throw new Error("用法：node scripts/import-training-drawings.mjs --directory <包含二十张 PNG 的目录> [--replace] [--url http://localhost:3000]");
const directory = await realpath(resolve(directoryArgument));
const origin = new URL(option("--url", "http://localhost:3000")).origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error("本地导入只允许 loopback 地址，防止把本地管理员凭据发送到远程主机");
const replace = process.argv.includes("--replace");
const stems = [
  "电动机点动控制电路", "电动机连续运行控制电路", "点动与连续运行电路", "接触器互锁正反转电路", "双重联锁正反转控制电路",
  "自动往返控制电路", "顺序控制电路", "延时起动控制电路", "Y-△降压起动控制电路", "双速电机运行控制电路",
];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const entries = await readdir(directory, { withFileTypes: true });
const files = [];
for (const [index, stem] of stems.entries()) {
  for (const [kind, suffix] of [["schematic", "原理图"], ["layout", "布局图"]]) {
    const expectedName = `${stem}${suffix}.png`;
    const source = entries.find(entry => entry.isFile() && entry.name.toLowerCase() === expectedName.toLowerCase());
    if (!source) throw new Error(`缺少原文件：${expectedName}；尚未上传任何文件`);
    const bytes = await readFile(resolve(directory, source.name));
    if (bytes.length < 8 || bytes.length > 12 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`文件不是有效 PNG 签名或超过 12 MiB：${source.name}`);
    files.push({ projectId: `project-${String(index + 1).padStart(2, "0")}`, kind, name: source.name, size: bytes.length, sha256: hash(bytes), bytes });
  }
}
const credentials = JSON.parse(await readFile(resolve(root, ".local/admin-access.json"), "utf8"));
const login = await fetch(`${origin}/api/auth/sign-in/username`, {
  method: "POST", headers: { origin, "content-type": "application/json" },
  body: JSON.stringify({ username: credentials.username, password: credentials.password }),
});
if (!login.ok) throw new Error(`管理员登录失败：HTTP ${login.status}`);
const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
async function call(path, method = "GET", body) {
  const response = await fetch(`${origin}/api${path}`, {
    method, headers: { cookie, ...(method !== "GET" ? { origin } : {}), ...(body instanceof FormData || body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(`${method} ${path} 失败：${detail.code || response.status}`);
  }
  return response;
}
const manifestPath = resolve(root, ".local/training-drawing-import.json");
const previous = JSON.parse(await readFile(manifestPath, "utf8").catch(() => "null"));
const manifest = { origin, directory, startedAt: new Date().toISOString(), entries: [] };
async function saveManifest() { await mkdir(resolve(root, ".local"), { recursive: true }); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); }
try {
  const session = await call("/session").then(response => response.json());
  assert.equal(session.user?.role, "admin", "必须使用管理员账号");
  const projects = await call("/training-projects").then(response => response.json());
  // Inspect every existing association before the first upload, so a conflict
  // cannot silently leave a half-replaced course set.
  for (const file of files) {
    const project = projects.items.find(item => item.id === file.projectId);
    if (!project?.drawings) throw new Error(`项目或双图接口不存在：${file.projectId}`);
    file.currentMediaId = project.drawings[file.kind]?.id || null;
    if (file.currentMediaId) {
      const stored = Buffer.from(await call(`/media/${file.currentMediaId}`).then(response => response.arrayBuffer()));
      file.same = hash(stored) === file.sha256;
      if (!file.same && !replace) throw new Error(`${file.projectId}/${file.kind} 已有关联的不同图纸，尚未上传任何文件；核实后使用 --replace 才会替换`);
    }
  }
  let uploaded = 0, unchanged = 0;
  for (const file of files) {
    const { bytes, same, currentMediaId, ...metadata } = file;
    const entry = { ...metadata, mediaId: currentMediaId, action: same ? "unchanged" : currentMediaId ? "replace" : "create", verified: false };
    manifest.entries.push(entry);
    if (same) unchanged += 1;
    else {
      const cached = previous?.origin === origin && previous?.directory === directory
        ? previous.entries?.find(item => item.projectId === file.projectId && item.kind === file.kind && item.sha256 === file.sha256 && item.mediaId)
        : undefined;
      if (cached) {
        const response = await fetch(`${origin}/api/media/${cached.mediaId}`, { headers: { cookie } });
        if (response.ok && hash(Buffer.from(await response.arrayBuffer())) === file.sha256) entry.mediaId = cached.mediaId;
      }
      if (!entry.mediaId || entry.mediaId === currentMediaId) {
        const form = new FormData(); form.append("file", new File([bytes], basename(file.name), { type: "image/png" }));
        const result = await call("/media", "POST", form).then(response => response.json());
        entry.mediaId = result.media.id; uploaded += 1;
      }
      await saveManifest();
      await call(`/training-projects/${file.projectId}`, "PUT", { kind: file.kind, mediaId: entry.mediaId, expectedMediaId: currentMediaId });
    }
    const stored = Buffer.from(await call(`/media/${entry.mediaId}`).then(response => response.arrayBuffer()));
    assert.equal(hash(stored), file.sha256, `${file.name} 上传读回哈希不一致`);
    entry.verified = true;
    await saveManifest();
    console.log(`${file.projectId}/${file.kind} ${same ? "内容相同，保留现有文件" : "已关联并核对哈希"}`);
  }
  const readback = await call("/training-projects").then(response => response.json());
  for (const file of manifest.entries) assert.equal(readback.items.find(item => item.id === file.projectId).drawings[file.kind]?.id, file.mediaId);
  manifest.completedAt = new Date().toISOString(); manifest.uploaded = uploaded; manifest.unchanged = unchanged;
  await saveManifest();
  console.log(`已核验 ${files.length} 张图纸，新上传 ${uploaded}，保持原有 ${unchanged}。原文件未修改。记录：${manifestPath}`);
} finally {
  await call("/auth/sign-out", "POST", {}).catch(() => undefined);
}
