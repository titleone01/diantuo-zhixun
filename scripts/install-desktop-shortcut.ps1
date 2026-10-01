$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$nodePath = (Get-Command node -ErrorAction Stop).Source
$runtimeDir = Join-Path $root '.local'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
@{ nodePath = $nodePath } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDir 'windows-launcher.json') -Encoding UTF8
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '启动电拓智训.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'start-desktop.ps1')`""
$shortcut.WorkingDirectory = $root
$shortcut.Description = '启动电拓智训网页服务和固定网址连接，完成后打开本机网页'
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output "已创建桌面快捷方式：$shortcutPath"
