$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Import-Module -Name (Join-Path (Join-Path $PSHOME "Modules") (Join-Path "Microsoft.PowerShell.Security" "Microsoft.PowerShell.Security.psd1")) -Force -ErrorAction Stop

if (-not $env:LOCALAPPDATA) {
  throw "No se encontró LOCALAPPDATA para este usuario de Windows."
}

$secureToken = Read-Host "Pegá el INGEST_TOKEN de Didi Dash (se guarda cifrado; no se muestra)" -AsSecureString
if ($secureToken.Length -lt 16) {
  $secureToken.Dispose()
  throw "El token parece demasiado corto. No se guardó ningún cambio."
}

$directory = Join-Path $env:LOCALAPPDATA "DidiDash"
$credentialFile = Join-Path $directory "ingest-token.dpapi"

try {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $encrypted = ConvertFrom-SecureString -SecureString $secureToken
  [System.IO.File]::WriteAllText($credentialFile, $encrypted, [System.Text.Encoding]::ASCII)
  Write-Output "Credencial protegida para este usuario de Windows."
  Write-Output "Ubicación: $credentialFile"
  Write-Output "Para reemplazarla o rotarla, ejecutá nuevamente npm run companion:setup."
}
finally {
  $secureToken.Dispose()
}
