param(
    [switch]$Release,
    [switch]$Run
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

# Use the repository-local toolchain when present; otherwise use the system one.
$localCargo = Join-Path $projectRoot '.local-tools/cargo'
if (Test-Path -LiteralPath (Join-Path $localCargo 'bin/cargo.exe')) {
    $env:CARGO_HOME = $localCargo
    $env:RUSTUP_HOME = Join-Path $projectRoot '.local-tools/rustup'
    $env:PATH = (Join-Path $localCargo 'bin') + ';' + $env:PATH
}

$buildArguments = @(
    'run', 'tauri', '--', 'build', '--no-bundle',
    '--config', 'src-tauri/tauri.local.conf.json'
)
if (-not $Release) {
    $buildArguments += '--debug'
}
$buildArguments += @('--', '--locked')

if (Get-Command rtk -ErrorAction SilentlyContinue) {
    & rtk proxy npm @buildArguments
} else {
    & npm @buildArguments
}
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$profile = if ($Release) { 'release' } else { 'debug' }
$executable = Join-Path $projectRoot "src-tauri/target/$profile/pluely.exe"
Write-Output "Built: $executable"
if ($Run) {
    Start-Process -FilePath $executable
}
