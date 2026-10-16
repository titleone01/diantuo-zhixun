param([switch]$NoOpen, [switch]$NoDialog)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$root = Split-Path $PSScriptRoot -Parent
$runtimeDir = Join-Path $root '.local'
$logDir = Join-Path $runtimeDir 'desktop-launcher'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$hash = [System.Security.Cryptography.SHA256]::Create()
$key = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())))).Replace('-', '')
$mutex = New-Object System.Threading.Mutex($false, "Local\DiantuoStart-$key")
$locked = $false

function Show-Result([string]$message, [bool]$failed = $false) {
    if ($NoDialog) { Write-Output $message; return }
    Add-Type -AssemblyName System.Windows.Forms
    $icon = if ($failed) { [Windows.Forms.MessageBoxIcon]::Warning } else { [Windows.Forms.MessageBoxIcon]::Information }
    [Windows.Forms.MessageBox]::Show($message, '电拓智训', [Windows.Forms.MessageBoxButtons]::OK, $icon) | Out-Null
}

try {
    try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { Show-Result '电拓智训正在启动，请等待启动结果，不需要重复点击。'; exit 0 }
    $config = Join-Path $runtimeDir 'windows-launcher.json'
    $nodePath = if (Test-Path -LiteralPath $config) { (Get-Content -LiteralPath $config -Raw | ConvertFrom-Json).nodePath } else { $null }
    $bundledNode = Join-Path $root '.local/tools/node/node.exe'
    if (Test-Path -LiteralPath $bundledNode -PathType Leaf) { $nodePath = $bundledNode }
    if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath)) { $nodePath = (Get-Command node -ErrorAction Stop).Source }
    $output = & $nodePath (Join-Path $root 'scripts/desktop-services.mjs') 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
    $result = ($output -join [Environment]::NewLine) | ConvertFrom-Json
    if (-not $NoOpen) { Start-Process 'http://localhost:3000/' }
    $notice = if ($result.publicReady) {
        '固定网址的页面、会话及同源请求已通过检查。'
    } else {
        '本机服务和443转发程序已启动，公网暂未通过检查。连接器会持续检测网络并重连，联网或换网后无需再次启动。'
    }
    # Release the startup lock before displaying the completed result.
    $mutex.ReleaseMutex()
    $locked = $false
    $message = @(
        '电拓智训已在后台运行。', '',
        '本机：http://localhost:3000/',
        ('其他电脑：{0}/' -f $result.publicUrl), '', $notice,
        '关闭浏览器不会停止服务。请保持本机开机、联网且不休眠。',
        'Windows登录启动项和桌面入口共用同一启动流程。'
    ) -join [Environment]::NewLine
    Show-Result $message (-not $result.publicReady)
} catch {
    $message = $_.Exception.Message
    $message | Set-Content -LiteralPath (Join-Path $logDir 'last-error.txt') -Encoding UTF8
    Show-Result (('启动未完成：' + $message) + [Environment]::NewLine + [Environment]::NewLine + '已运行的服务不会被强制结束。') $true
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
    $hash.Dispose()
}
