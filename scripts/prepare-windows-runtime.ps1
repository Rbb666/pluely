param(
    [string]$CabPath,
    [string]$Destination,
    [string]$LicenseJsonPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$manifestPath = Join-Path $projectRoot 'src-tauri/windows/webview2-runtime.json'
$runtime = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($runtime.architecture -ne 'x64' -or $runtime.version -notmatch '^\d+\.\d+\.\d+\.\d+$' -or $runtime.sha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Invalid pinned WebView2 runtime manifest.'
}
if (-not $Destination) { $Destination = Join-Path $projectRoot 'src-tauri/runtime' }
$Destination = [IO.Path]::GetFullPath($Destination)
if (-not $Destination.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Runtime destination must remain inside this repository.'
}
if (Test-Path -LiteralPath $Destination) {
    throw "Runtime destination already exists: $Destination. Reuse it, or choose a new empty destination."
}

$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
$workDirectory = Join-Path $temporaryRoot ('pluely-webview2-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workDirectory | Out-Null
$runtimeDirectoryName = "Microsoft.WebView2.FixedVersionRuntime.$($runtime.version).$($runtime.architecture)"

try {
    if ($CabPath) {
        $archive = (Resolve-Path -LiteralPath $CabPath).Path
    } else {
        $archive = Join-Path $workDirectory ($runtimeDirectoryName + '.cab')
        & curl.exe --fail --location --retry 3 --output $archive $runtime.url
        if ($LASTEXITCODE -ne 0) { throw 'Could not download the pinned WebView2 runtime.' }
    }

    # Verify before extracting; neither an updated download nor a cached CAB is trusted implicitly.
    $stream = [IO.File]::OpenRead($archive)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actualHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha.Dispose() }
    if ($actualHash -ne $runtime.sha256) { throw 'WebView2 CAB SHA-256 does not match the pinned manifest.' }

    & "$env:SystemRoot/System32/expand.exe" $archive '-F:*' $workDirectory | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not extract the WebView2 CAB.' }
    $extractedRuntime = Join-Path $workDirectory $runtimeDirectoryName
    foreach ($file in @('msedgewebview2.exe', 'msedge.dll', 'icudtl.dat', 'locales/en-US.pak')) {
        if (-not (Test-Path -LiteralPath (Join-Path $extractedRuntime $file) -PathType Leaf)) {
            throw "Extracted runtime is incomplete: $file"
        }
    }

    if ($LicenseJsonPath) {
        $license = Get-Content -LiteralPath $LicenseJsonPath -Raw | ConvertFrom-Json
    } else {
        $licenseFile = Join-Path $workDirectory 'license.json'
        & curl.exe --fail --location --retry 3 --output $licenseFile $runtime.licenseUrl
        if ($LASTEXITCODE -ne 0) { throw 'Could not download the Microsoft Fixed Runtime license.' }
        $license = Get-Content -LiteralPath $licenseFile -Raw | ConvertFrom-Json
    }
    if ($license.fixedHtml -notmatch 'MICROSOFT EDGE WEBVIEW2 RUNTIME \(FIXED VERSION\)') {
        throw 'The downloaded license is not the Microsoft Fixed Runtime license.'
    }
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $extractedRuntime 'Microsoft-WebView2-Fixed-License.html'),
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Microsoft Edge WebView2 Runtime Fixed Version License</title></head><body>' + $license.fixedHtml + '</body></html>', $utf8)
    [IO.File]::WriteAllText((Join-Path $extractedRuntime 'WebView2-Source.txt'),
        "Microsoft Edge WebView2 Fixed Version Runtime`nVersion: $($runtime.version)`nArchitecture: $($runtime.architecture)`nSource: $($runtime.url)`nCAB SHA256: $actualHash`nLicense: $($runtime.licenseUrl)`nAll Microsoft CAB files are included without modification.`n", $utf8)

    # Preserve every CAB file, including nested resources and third-party notices.
    $extractedRuntime = (Resolve-Path -LiteralPath $extractedRuntime).Path
    if (-not $extractedRuntime.StartsWith($workDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Unexpected extraction path.'
    }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $extractedRuntime -Force | Copy-Item -Destination $Destination -Recurse
    Write-Output "Prepared WebView2 $($runtime.version) $($runtime.architecture): $Destination"
} finally {
    # Only remove this invocation's generated temporary directory, never a supplied CAB or destination.
    $resolvedWork = [IO.Path]::GetFullPath($workDirectory)
    if ($resolvedWork.StartsWith($temporaryRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedWork) -match '^pluely-webview2-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolvedWork -Recurse -Force
    }
}
