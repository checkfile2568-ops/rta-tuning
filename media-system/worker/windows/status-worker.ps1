[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$workerRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $workerRoot 'docker-compose.yml'
$envFile = Join-Path $workerRoot '.env'

& docker compose --project-directory $workerRoot --env-file $envFile -f $composeFile ps
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/health' -TimeoutSec 5
  $health | ConvertTo-Json -Depth 4
} catch {
  Write-Warning 'Worker health endpoint is not available yet.'
}
