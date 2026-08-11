# Run this on the acceptance VM BEFORE installing.
# A hash mismatch means the file was corrupted or swapped in transit: do not install it.
$ErrorActionPreference = 'Stop'

$expected  = '0d4a0c7306b95ab9fc2b7900138d8135c09b6810399181bc96111c274efc712d'
$installer = Join-Path $PSScriptRoot 'BeybladeTracker-1.0.0-Setup.exe'

if (-not (Test-Path -LiteralPath $installer)) {
  Write-Host "MISSING: $installer" -ForegroundColor Red
  exit 1
}

$actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLower()
$size   = (Get-Item -LiteralPath $installer).Length

Write-Host "file     : $installer"
Write-Host "size     : $size bytes"
Write-Host "expected : $expected"
Write-Host "actual   : $actual"
Write-Host ""

if ($actual -eq $expected) {
  Write-Host 'MATCH - safe to install.' -ForegroundColor Green
  exit 0
}

Write-Host 'MISMATCH - DO NOT INSTALL. Re-copy the installer from the build machine.' -ForegroundColor Red
exit 1
