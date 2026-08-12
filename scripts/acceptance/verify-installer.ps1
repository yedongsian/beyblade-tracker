# Run this on the acceptance machine BEFORE installing.
# A mismatch means the file was corrupted or swapped while being copied here: do not install it.
#
# The expectation comes from SHA256.txt, written next to the installer by the build machine. That
# checks the copy arrived intact - it is not proof of provenance, since a bad copy of both files
# would agree with itself. Provenance is what Authenticode signing will give us (BT-P0-001).
#
# It used to be a constant in this file, which broke every time the script was re-synced from
# version control over a newer artifact: the old hash came back and a good installer read as
# MISMATCH. Keeping the expectation beside the artifact removes that whole class of mistake.
$ErrorActionPreference = 'Stop'

$installer = Join-Path $PSScriptRoot 'BeybladeTracker-1.0.0-Setup.exe'
$manifest  = Join-Path $PSScriptRoot 'SHA256.txt'

if (-not (Test-Path -LiteralPath $installer)) {
  Write-Host "MISSING: $installer" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path -LiteralPath $manifest)) {
  Write-Host "MISSING: $manifest" -ForegroundColor Red
  Write-Host '請從建置機一併複製 SHA256.txt，它記錄了本次產物的預期雜湊。' -ForegroundColor Red
  exit 1
}

$line = (Get-Content -LiteralPath $manifest -First 1)
if ($line -notmatch '^([0-9a-fA-F]{64})\s') {
  Write-Host "UNREADABLE: $manifest" -ForegroundColor Red
  Write-Host '預期格式為「<64 位十六進位雜湊>  <檔名>」。' -ForegroundColor Red
  exit 1
}
$expected = $Matches[1].ToLower()

$actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLower()
$size   = (Get-Item -LiteralPath $installer).Length

Write-Host "file     : $installer"
Write-Host "size     : $size bytes"
Write-Host "expected : $expected  (來自 SHA256.txt)"
Write-Host "actual   : $actual"
Write-Host ""

if ($actual -eq $expected) {
  Write-Host 'MATCH - safe to install.' -ForegroundColor Green
  exit 0
}

Write-Host 'MISMATCH - DO NOT INSTALL. Re-copy the installer from the build machine.' -ForegroundColor Red
exit 1
