@echo off
chcp 65001 >nul
setlocal
set "DIANTUO_NODE=%~dp0.local\tools\node\node.exe"
if not exist "%DIANTUO_NODE%" set "DIANTUO_NODE=node"
echo 1. 只检查项目完整性（推荐）
echo 2. 换位置后修复路径（必须先停止原服务）
choice /c 12 /n /m "请选择 1 或 2："
if errorlevel 2 goto rebase
"%DIANTUO_NODE%" "%~dp0scripts\migration-check.mjs"
goto done
:rebase
"%DIANTUO_NODE%" "%~dp0scripts\migration-check.mjs" --rebase
if errorlevel 1 goto done
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-desktop-shortcut.ps1"
:done
pause
