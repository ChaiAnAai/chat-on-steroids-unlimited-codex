$ErrorActionPreference = 'Stop'
$developmentRoot = Split-Path -Parent $PSScriptRoot
$developmentRuntime = Join-Path $developmentRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath (Join-Path $developmentRoot 'out\main\index.js'))) { throw 'Run npm run build first. This entry is for development only.' }
$env:CLF_BRIDGE_PORTS = '0'
$env:ELECTRON_RUN_AS_NODE = $null
Start-Process -FilePath $developmentRuntime -ArgumentList @(('"' + $developmentRoot + '"'), '--ui-preview') -WorkingDirectory $developmentRoot -WindowStyle Hidden
