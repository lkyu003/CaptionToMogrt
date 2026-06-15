$ErrorActionPreference = "Stop"

$extensionId = "com.local.srtmogrt"
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $env:APPDATA "Adobe\CEP\extensions\$extensionId"

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force

Write-Host "Installed $extensionId to $target"
Write-Host "Restart Premiere Pro, then open Window > Extensions > SRT to MOGRT."
Write-Host "If unsigned CEP panels are blocked, enable PlayerDebugMode manually as described in README.md."
