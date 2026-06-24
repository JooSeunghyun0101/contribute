# 로컬 HTTP 서버 기동 (file:// CORS 회피용)
# 사용: .\serve.ps1
# 종료: Ctrl+C

$ErrorActionPreference = "Stop"
$port = 8123
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "Claude Design Reference (2026-04-23)" -ForegroundColor Cyan
Write-Host "--------------------------------------"
Write-Host "  Prototype : http://localhost:$port/prototype.html"
Write-Host ""
Write-Host "Ctrl+C 로 종료" -ForegroundColor DarkGray
Write-Host ""

Set-Location $here
python -m http.server $port
