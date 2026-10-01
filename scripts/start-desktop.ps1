param([switch]$NoOpen, [switch]$NoDialog)
$ErrorActionPreference = 'Stop'
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

function Test-Local {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/session' -TimeoutSec 3
        $body = $response.Content | ConvertFrom-Json
        return ($response.StatusCode -eq 200 -and $null -ne $body -and $body.PSObject.Properties.Name -contains 'user')
    } catch { return $false }
}

function Test-Tunnel {
    try { return (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:20251/ready' -TimeoutSec 3).StatusCode -eq 200 }
    catch { return $false }
}

function Start-Helper([string]$script, [string]$name) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdout = Join-Path $logDir "$stamp-$name.out.log"
    $stderr = Join-Path $logDir "$stamp-$name.err.log"
    $child = Start-Process -FilePath $script:nodePath -ArgumentList @("`"$(Join-Path $root $script)`"") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    return $child
}

function Wait-Ready($child, [scriptblock]$probe, [string]$label, [int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $probe) { return }
        $child.Refresh()
        if ($child.HasExited) {
            if (& $probe) { return }
            throw "$label 启动退出，请查看日志：$logDir"
        }
        Start-Sleep -Milliseconds 600
    }
    throw "$label 尚未就绪。请稍后再次双击快捷方式，或查看日志：$logDir"
}

try {
    try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { Show-Result '电拓智训正在启动，请等待启动结果，不需要重复点击。'; exit 0 }
    $config = Join-Path $runtimeDir 'windows-launcher.json'
    $script:nodePath = if (Test-Path -LiteralPath $config) { (Get-Content -LiteralPath $config -Raw | ConvertFrom-Json).nodePath } else { $null }
    if (-not $script:nodePath -or -not (Test-Path -LiteralPath $script:nodePath)) { $script:nodePath = (Get-Command node -ErrorAction Stop).Source }
    $vars = Get-Content -LiteralPath (Join-Path $root '.dev.vars') -Raw
    $match = [regex]::Match($vars, '(?m)^APP_PUBLIC_ORIGIN\s*=\s*(.+)$')
    $publicUrl = $match.Groups[1].Value.Trim().Trim('"', "'")
    $uri = $null
    if (-not [Uri]::TryCreate($publicUrl, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') {
        throw '没有有效的固定 HTTPS 网址配置，请检查 APP_PUBLIC_ORIGIN。'
    }
    foreach ($required in @('node_modules/wrangler/bin/wrangler.js', '.local/tools/cloudflared.exe', '.local/network-access/tunnel-token.txt')) {
        if (-not (Test-Path -LiteralPath (Join-Path $root $required))) { throw "缺少启动文件：$required。请保留完整项目目录。" }
    }
    if (-not (Test-Local)) {
        $service = Start-Helper 'scripts/start-local.mjs' 'service'
        Wait-Ready $service { Test-Local } '网页服务' 180
    }
    if (-not (Test-Tunnel)) {
        $tunnel = Start-Helper 'scripts/start-tunnel.mjs' 'tunnel'
        Wait-Ready $tunnel { Test-Tunnel } '固定网址连接' 90
    }
    $publicReady = $false
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$($uri.GetLeftPart([UriPartial]::Authority))/api/session" -TimeoutSec 20
        $body = $response.Content | ConvertFrom-Json
        $publicReady = $response.StatusCode -eq 200 -and $null -ne $body -and $body.PSObject.Properties.Name -contains 'user'
    } catch { }
    $result = [ordered]@{ checkedAt = (Get-Date).ToString('o'); localReady = $true; tunnelReady = $true; publicReady = $publicReady; publicUrl = $uri.GetLeftPart([UriPartial]::Authority) }
    $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logDir 'last-result.json') -Encoding UTF8
    if (-not $NoOpen) { Start-Process 'http://localhost:3000/' }
    $notice = if ($publicReady) { '固定网址已验证可访问。' } else { '本机服务和连接已启动，固定网址暂未验证成功；请稍后重试网址。' }
    Show-Result "电拓智训已在后台运行。`r`n`r`n本机：http://localhost:3000/`r`n其他电脑：$($result.publicUrl)/`r`n`r`n$notice`r`n关闭浏览器不会停止服务。请保持本机开机、联网且不休眠。`r`n关机后，下次开机再双击此快捷方式。" (-not $publicReady)
} catch {
    $message = $_.Exception.Message
    $message | Set-Content -LiteralPath (Join-Path $logDir 'last-error.txt') -Encoding UTF8
    Show-Result "启动未完成：$message`r`n`r`n已运行的服务不会被强制结束。" $true
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
    $hash.Dispose()
}
