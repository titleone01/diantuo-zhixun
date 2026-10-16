param([string]$PublicOrigin, [string]$RelayDirectory, [switch]$InstallLoginStartup)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$bundledNode = Join-Path $root '.local/tools/node/node.exe'
$nodePath = if (Test-Path -LiteralPath $bundledNode -PathType Leaf) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$runtimeDir = Join-Path $root '.local'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$configPath = Join-Path $runtimeDir 'windows-launcher.json'
$config = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
$config | Add-Member -NotePropertyName nodePath -NotePropertyValue $nodePath -Force
if ($PublicOrigin) {
    $uri = $null
    if (-not [Uri]::TryCreate($PublicOrigin, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') { throw 'PublicOrigin 必须是固定 HTTPS 站点地址。' }
    $config | Add-Member -NotePropertyName publicOrigin -NotePropertyValue ($uri.GetLeftPart([UriPartial]::Authority)) -Force
}
if ($RelayDirectory) {
    $relayPath = [IO.Path]::GetFullPath((Join-Path $root $RelayDirectory))
    if (-not $relayPath.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'RelayDirectory 必须位于当前项目内。' }
    foreach ($file in @('run-connector.mjs', 'production/connector-key.dpapi')) {
        if (-not (Test-Path -LiteralPath (Join-Path $relayPath $file) -PathType Leaf)) { throw "缺少转发启动文件：$file" }
    }
    $config | Add-Member -NotePropertyName relayScript -NotePropertyValue (Join-Path $RelayDirectory 'run-connector.mjs') -Force
    $config | Add-Member -NotePropertyName relayCredential -NotePropertyValue (Join-Path $RelayDirectory 'production/connector-key.dpapi') -Force
}
if (-not $config.publicOrigin -or -not $config.relayScript -or -not $config.relayCredential) { throw '请提供已接入的 PublicOrigin 和 RelayDirectory。' }
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '启动电拓智训.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f (Join-Path $PSScriptRoot 'start-desktop.ps1')
$shortcut.WorkingDirectory = $root
$shortcut.Description = '启动电拓智训网页服务、443公网转发和备用隧道；换网自动重连'
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output "已更新桌面快捷方式：$shortcutPath"
$siblingLauncher = Join-Path (Split-Path $root -Parent) '启动电拓智训.cmd'
$projectName = Split-Path $root -Leaf
# Percent expansion is the only cmd syntax inside this quoted project path.
if ($projectName -match '[%\r\n"]') { throw '项目文件夹名称含不支持的启动字符。' }
$launcherText = '@echo off' + "`r`n" + 'chcp 65001 >nul' + "`r`n" + 'setlocal' + "`r`n" + ('call "%~dp0{0}\01-启动电拓智训.cmd" %*' -f $projectName) + "`r`n" + 'exit /b %errorlevel%' + "`r`n"
[IO.File]::WriteAllText($siblingLauncher, $launcherText, (New-Object Text.UTF8Encoding($false)))
Write-Output "已更新项目同级启动入口：$siblingLauncher"
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) '电拓智训公网转发.lnk'
if ($InstallLoginStartup -or (Test-Path -LiteralPath $startupPath)) {
    $startup = $shell.CreateShortcut($startupPath)
    $startup.TargetPath = $shortcut.TargetPath
    $startup.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -NoOpen -NoDialog' -f (Join-Path $PSScriptRoot 'start-desktop.ps1')
    $startup.WorkingDirectory = $root
    $startup.Description = '登录Windows后启动电拓智训和443公网转发；复用已有进程并自动重连'
    $startup.IconLocation = $shortcut.IconLocation
    $startup.WindowStyle = 7
    $startup.Save()
    Write-Output "已统一Windows登录启动入口：$startupPath"
}
