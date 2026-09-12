param([switch]$ValidateOnly, [string]$ManifestPath)
$ErrorActionPreference = 'Stop'
$previewRoot = Split-Path -Parent $PSScriptRoot
if (-not $ManifestPath) { $ManifestPath = Join-Path $previewRoot 'preview-build.json' }
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { throw 'No verified preview manifest. The previous build is not selected automatically.' }
$previewManifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($previewManifest.schemaVersion -ne 1 -or $previewManifest.status -ne 'PASS_SCOPED' -or
    $previewManifest.dataDirectory -ne 'Chat On Steroids UI Preview' -or
    $previewManifest.version -notmatch '^\d+\.\d+\.\d+-accounts-preview\.\d+$' -or
    $previewManifest.files.Count -lt 3) { throw 'Invalid preview manifest.' }
function Get-PreviewFile([string]$RelativePath) {
  if (-not $RelativePath -or [IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -match '[:\x00-\x1f]' -or $RelativePath -match '(^|[\\/])\.\.([\\/]|$)') { throw 'Invalid preview file path.' }
  $candidate = [IO.Path]::GetFullPath((Join-Path $previewRoot $RelativePath))
  $prefix = [IO.Path]::GetFullPath($previewRoot).TrimEnd('\') + '\'
  if (-not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Preview path leaves the workspace.' }
  $cursor = Get-Item -LiteralPath $candidate
  while ($cursor.FullName -ne $previewRoot) {
    if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Preview paths may not contain links.' }
    if ($cursor -is [IO.FileInfo]) { $cursor = $cursor.Directory } else { $cursor = $cursor.Parent }
    if (-not $cursor) { throw 'Preview path leaves the workspace.' }
  }
  return $candidate
}
$previewPackaged = Get-PreviewFile $previewManifest.executable
if ($previewManifest.executable -notmatch '^release-[^/\\]+[/\\]win-unpacked[/\\]Chat On Steroids\.exe$') { throw 'Invalid preview executable.' }
$seen = @{}
foreach ($entry in $previewManifest.files) {
  if ($seen.ContainsKey($entry.path) -or $entry.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid or duplicate preview digest.' }
  $seen[$entry.path] = $true
  $verifiedPath = Get-PreviewFile $entry.path
  $stream = [IO.File]::OpenRead($verifiedPath)
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $digest = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
  finally { $stream.Dispose(); $hasher.Dispose() }
  if ($digest -ne $entry.sha256) { throw "Preview file changed: $($entry.path). Rebuild and verify before launching." }
}
$previewPackageRoot = (Split-Path -Parent $previewManifest.executable).Replace('\', '/')
foreach ($required in @($previewManifest.executable, ($previewPackageRoot + '/resources/app.asar'), ($previewPackageRoot + '/resources/extension/manifest.json'))) {
  if (-not $seen.ContainsKey($required)) { throw "Missing preview digest: $required" }
}
Write-Output ("Verified preview: {0}; data: {1}" -f $previewManifest.version, $previewManifest.dataDirectory)
if ($ValidateOnly) { return }
$env:CLF_BRIDGE_PORTS = '0'
$env:ELECTRON_RUN_AS_NODE = $null
Start-Process -FilePath $previewPackaged -ArgumentList '--ui-preview' -WorkingDirectory (Split-Path -Parent $previewPackaged) -WindowStyle Hidden
