param(
    [string]$SeedDirectory = '.local-tools/migration-private/current'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$seedPath = (Resolve-Path -LiteralPath $SeedDirectory).Path
foreach ($requiredFile in @('settings.json', 'pluely.db', 'manifest.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $seedPath $requiredFile) -PathType Leaf)) {
        throw "Migration snapshot is incomplete: missing $requiredFile"
    }
}
$manifestPath = Join-Path $seedPath 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $manifest.id) {
    $manifest | Add-Member -NotePropertyName id -NotePropertyValue ([Guid]::NewGuid().ToString())
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20))
}

$previousSeed = $env:PLUELY_MIGRATION_SEED_DIR
try {
    $env:PLUELY_MIGRATION_SEED_DIR = $seedPath
    $buildScript = Join-Path $PSScriptRoot 'build-local.ps1'
    if (Get-Command rtk -ErrorAction SilentlyContinue) {
        & rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File $buildScript -Release
    } else {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $buildScript -Release
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    if ($null -eq $previousSeed) { Remove-Item Env:PLUELY_MIGRATION_SEED_DIR -ErrorAction SilentlyContinue }
    else { $env:PLUELY_MIGRATION_SEED_DIR = $previousSeed }
}

$outputDirectory = Join-Path $projectRoot 'release-private'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$stamp = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTimeOffset]::UtcNow, 'China Standard Time').ToString('yyyyMMdd-HHmmss')
$destination = Join-Path $outputDirectory "Pluely-Local-UserData-win-x64-$stamp.exe"
Copy-Item -LiteralPath (Join-Path $projectRoot 'src-tauri/target/release/pluely.exe') -Destination $destination
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
$packageStream = [IO.File]::OpenRead($destination)
try {
    $hash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($packageStream)).Replace('-', '').ToLowerInvariant()
} finally {
    $packageStream.Dispose()
    $hashAlgorithm.Dispose()
}
[IO.File]::WriteAllText("$destination.sha256", "$hash  $([IO.Path]::GetFileName($destination))`n")
Write-Output "Private migration executable: $destination"
Write-Output "SHA256: $hash"
