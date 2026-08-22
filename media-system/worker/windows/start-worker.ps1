[CmdletBinding()]
param(
  [int]$DockerWaitSeconds = 300
)

$ErrorActionPreference = 'Stop'
$workerRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $workerRoot 'docker-compose.yml'
$envFile = Join-Path $workerRoot '.env'
$dockerReady = $false

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing private configuration: $envFile. Copy .env.example to .env and set this computer's unique WORKER_ID."
}

$deadline = (Get-Date).AddSeconds($DockerWaitSeconds)
do {
  try {
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) {
      $dockerReady = $true
      break
    }
  } catch { }
  Start-Sleep -Seconds 5
} while ((Get-Date) -lt $deadline)

if (-not $dockerReady) {
  throw "Docker Desktop is not ready after $DockerWaitSeconds seconds. Open Docker Desktop, then run this script again."
}

& docker compose --project-directory $workerRoot --env-file $envFile -f $composeFile up -d
if ($LASTEXITCODE -ne 0) { throw 'Unable to start MMs Media Worker.' }

Write-Host 'MMs Media Worker started. Check http://127.0.0.1:8080/health after a few seconds.'
