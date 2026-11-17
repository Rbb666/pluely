$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath 'src-tauri/runtime/msedgewebview2.exe')) {
    throw 'Stage the official Fixed Runtime with scripts/stage-fixed-runtime.py first.'
}
$localCargo = Join-Path $projectRoot '.local-tools/cargo'
if (Test-Path -LiteralPath (Join-Path $localCargo 'bin/cargo.exe')) {
    $env:CARGO_HOME = $localCargo
    $env:RUSTUP_HOME = Join-Path $projectRoot '.local-tools/rustup'
    $env:PATH = (Join-Path $localCargo 'bin') + ';' + $env:PATH
}
# Installers are reusable. Personal data is only supplied through an import file.
$previousSeed = $env:PLUELY_MIGRATION_SEED_DIR
try {
    Remove-Item Env:PLUELY_MIGRATION_SEED_DIR -ErrorAction SilentlyContinue
    $buildArguments = @('run', 'tauri', '--', 'build', '--config', 'src-tauri/tauri.installer.conf.json', '--bundles', 'nsis', '--', '--locked')
    if (Get-Command rtk -ErrorAction SilentlyContinue) {
        & rtk proxy npm @buildArguments
    } else {
        & npm @buildArguments
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    if ($null -ne $previousSeed) { $env:PLUELY_MIGRATION_SEED_DIR = $previousSeed }
}
