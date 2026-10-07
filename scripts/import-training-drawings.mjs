import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`${name} 需要参数`);
  return argv[index + 1];
}

export function trainingDrawingOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("图纸验收地址必须是有效的 loopback origin"); }
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("图纸验收只允许不含账号、路径或查询参数的 loopback origin");
  }
  return url.origin;
}

function defaultOrigin(origin) {
  const url = new URL(origin);
  return url.protocol === "http:" && url.port === "3000";
}

export function trainingDrawingOptions(mode, argv = process.argv.slice(2), environment = process.env) {
  const local = resolve(root, ".local");
  const manifestArgument = option(argv, "--manifest");
  const artifactArgument = option(argv, "--artifact-dir", environment.DIANTUO_TEST_ARTIFACT_DIR);
  const artifactDirectory = resolve(artifactArgument || (manifestArgument ? dirname(resolve(manifestArgument)) : local));
  const adminArgument = option(argv, "--admin-file", environment.DIANTUO_TEST_ADMIN_PATH);
  const originArgument = option(argv, "--url", environment.DIANTUO_TEST_URL);
  if (mode === "import" && !originArgument && (adminArgument || artifactArgument || manifestArgument)) throw new Error("使用独立凭据或证据目录导入时，必须同时指定 --url 或 DIANTUO_TEST_URL，避免误写默认站点");
  const origin = originArgument ? trainingDrawingOrigin(originArgument) : mode === "import" ? "http://localhost:3000" : undefined;
  const paths = {
    origin,
    directoryArgument: option(argv, "--directory"),
    replace: argv.includes("--replace"),
    artifactDirectory,
    manifestPath: resolve(manifestArgument || resolve(artifactDirectory, "training-drawing-import.json")),
    adminPath: resolve(adminArgument || resolve(local, "admin-access.json")),
    accountsPath: resolve(option(argv, "--accounts-file", resolve(artifactDirectory, "test-accounts.json"))),
    evidencePath: resolve(artifactDirectory, "training-drawing-acceptance.json"),
  };
  if (origin && !defaultOrigin(origin)) assertIsolatedDrawingPaths(mode, paths);
  return paths;
}

export function assertIsolatedDrawingPaths(mode, paths) {
  const local = resolve(root, ".local");
  const samePath = (left, right) => process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
  if (samePath(paths.manifestPath, resolve(local, "training-drawing-import.json"))) throw new Error("隔离地址必须通过 --manifest、--artifact-dir 或 DIANTUO_TEST_ARTIFACT_DIR 指定独立图纸证据目录");
  if (mode === "import" && samePath(paths.adminPath, resolve(local, "admin-access.json"))) throw new Error("隔离地址必须通过 --admin-file 或 DIANTUO_TEST_ADMIN_PATH 指定本次临时管理员");
  if (mode === "test" && samePath(paths.accountsPath, resolve(local, "test-accounts.json"))) throw new Error("隔离地址必须指定本次成员账号文件，不能使用项目 .local 的旧账号");
}

export function assertDrawingRecordOrigin(record, origin, label, { required = false } = {}) {
  if (!record?.origin) {
    // createFixture and backend-test-runner generate credentials without origin;
    // explicit isolated paths above are required before those records are read.
    if (required) throw new Error(`${label}缺少 origin，不能核实是否属于本次隔离环境`);
    return;
  }
  if (trainingDrawingOrigin(record.origin) !== origin) throw new Error(`${label}的 origin 与目标地址不一致；未发送登录凭据`);
}

export async function readDrawingJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") throw error;
    throw new Error(`无法读取图纸验收 JSON：${basename(path)}（内容未输出）`);
  }
}

export function trainingDrawingFetch(url, init = {}) {
  return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) });
}

export async function importTrainingDrawings(argv = process.argv.slice(2), environment = process.env) {
  const { directoryArgument, origin, replace, adminPath, manifestPath } = trainingDrawingOptions("import", argv, environment);
  if (!directoryArgument) throw new Error("用法：node scripts/import-training-drawings.mjs --directory <包含二十张 PNG 的目录> [--replace] [--url <origin> --admin-file <本次管理员 JSON> --artifact-dir <本次证据目录>] [--manifest <导入清单 JSON>]");
  const directory = await realpath(resolve(directoryArgument));
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
  const credentials = await readDrawingJson(adminPath);
  assertDrawingRecordOrigin(credentials, origin, "管理员记录");
  const previous = await readDrawingJson(manifestPath).catch(error => { if (error?.code === "ENOENT") return null; throw error; });
  if (previous) assertDrawingRecordOrigin(previous, origin, "已有导入清单", { required: true });
  const login = await trainingDrawingFetch(`${origin}/api/auth/sign-in/username`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ username: credentials.username, password: credentials.password }),
  });
  if (!login.ok) throw new Error(`管理员登录失败：HTTP ${login.status}`);
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  async function call(path, method = "GET", body) {
    const response = await trainingDrawingFetch(`${origin}/api${path}`, {
      method, headers: { cookie, ...(method !== "GET" ? { origin } : {}), ...(body instanceof FormData || body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(`${method} ${path} 失败：${detail.code || response.status}`);
    }
    return response;
  }
  const manifest = { origin, directory, startedAt: new Date().toISOString(), entries: [] };
  async function saveManifest() { await mkdir(dirname(manifestPath), { recursive: true }); await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); }
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
      file.expectedVersion = project.drawings[file.kind]?.version ?? null;
      if (file.currentMediaId && !file.expectedVersion) throw new Error(`图纸版本不可用：${file.projectId}/${file.kind}，请更新服务和脚本后重试`);
      if (file.currentMediaId) {
        const stored = Buffer.from(await call(`/media/${file.currentMediaId}`).then(response => response.arrayBuffer()));
        file.previousSha256 = hash(stored);
        file.same = file.previousSha256 === file.sha256;
        if (!file.same && !replace) throw new Error(`${file.projectId}/${file.kind} 已有关联的不同图纸，尚未上传任何文件；核实后使用 --replace 才会替换`);
      }
    }
    let uploaded = 0, unchanged = 0;
    for (const file of files) {
      const { bytes, same, currentMediaId, ...metadata } = file;
      const entry = { ...metadata, previousMediaId: currentMediaId, previousVersion: file.expectedVersion, mediaId: currentMediaId, action: same ? "unchanged" : currentMediaId ? "replace" : "create", verified: false };
      manifest.entries.push(entry);
      if (same) unchanged += 1;
      else {
        const cached = previous?.origin === origin && previous?.directory === directory
          ? previous.entries?.find(item => item.projectId === file.projectId && item.kind === file.kind && item.sha256 === file.sha256 && item.mediaId)
          : undefined;
        if (cached) {
          const response = await trainingDrawingFetch(`${origin}/api/media/${cached.mediaId}`, { headers: { cookie } });
          if (response.ok && hash(Buffer.from(await response.arrayBuffer())) === file.sha256) entry.mediaId = cached.mediaId;
        }
        if (!entry.mediaId || entry.mediaId === currentMediaId) {
          const form = new FormData(); form.append("file", new File([bytes], basename(file.name), { type: "image/png" }));
          const result = await call("/media", "POST", form).then(response => response.json());
          entry.mediaId = result.media.id; uploaded += 1;
        }
        await saveManifest();
        try {
          await call(`/training-projects/${file.projectId}`, "PUT", { kind: file.kind, mediaId: entry.mediaId, expectedVersion: file.expectedVersion });
        } catch (error) {
          // A timed-out write is uncertain. Read the current slot once; never
          // retry a mutation automatically or overwrite a competing update.
          const current = await call('/training-projects').then(response => response.json());
          const slot = current.items.find(item => item.id === file.projectId)?.drawings?.[file.kind];
          entry.writeReadback = { mediaId: slot?.id ?? null, version: slot?.version ?? null };
          await saveManifest();
          if (slot?.id !== entry.mediaId || typeof slot.version !== 'string' || slot.version === file.expectedVersion) throw error;
          entry.recoveredFromUncertainWrite = true;
        }
      }
      const stored = Buffer.from(await call(`/media/${entry.mediaId}`).then(response => response.arrayBuffer()));
      assert.equal(hash(stored), file.sha256, `${file.name} 上传读回哈希不一致`);
      const current = await call('/training-projects').then(response => response.json());
      const slot = current.items.find(item => item.id === file.projectId)?.drawings?.[file.kind];
      assert.equal(slot?.id, entry.mediaId, `${file.name} 槽位关联已变化`);
      entry.version = slot.version;
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await importTrainingDrawings(); }
  catch (error) { console.error(error instanceof Error ? error.message : "图纸导入失败"); process.exitCode = 1; }
}
