param(
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if ($Offline -and -not (Test-Path -LiteralPath 'src-tauri/runtime/msedgewebview2.exe')) {
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
$previousTargetDir = $env:CARGO_TARGET_DIR
try {
    Remove-Item Env:PLUELY_MIGRATION_SEED_DIR -ErrorAction SilentlyContinue
    $buildArguments = @('run', 'tauri', '--', 'build', '--config', 'src-tauri/tauri.installer.conf.json')
    if ($Offline) {
        $targetDir = if ($previousTargetDir) { $previousTargetDir } else { Join-Path $projectRoot 'src-tauri/target' }
        $env:CARGO_TARGET_DIR = Join-Path $targetDir 'offline'
        $buildArguments += @('--config', 'src-tauri/tauri.installer.offline.conf.json')
    }
    $buildArguments += @('--bundles', 'nsis', '--', '--locked')
    if (Get-Command rtk -ErrorAction SilentlyContinue) {
        & rtk proxy npm @buildArguments
    } else {
        & npm @buildArguments
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    if ($null -ne $previousSeed) { $env:PLUELY_MIGRATION_SEED_DIR = $previousSeed }
    if ($Offline) {
        if ($null -eq $previousTargetDir) {
            Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
        } else {
            $env:CARGO_TARGET_DIR = $previousTargetDir
        }
    }
}
