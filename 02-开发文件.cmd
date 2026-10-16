@echo off
chcp 65001 >nul
echo 1. 展开源码、配置与开发目录
echo 2. 恢复简洁视图
choice /c 12 /n /m "请选择 1 或 2："
if errorlevel 2 goto compact
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\folder-view.ps1" -Mode Develop
goto done
:compact
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\folder-view.ps1" -Mode Compact
:done
pause
