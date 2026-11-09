$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = 'http://127.0.0.1:8765/api/config'

try {
    Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1 | Out-Null
    Write-Host 'Service is already running: http://127.0.0.1:8765/'
    exit 0
} catch {}

try {
    $python = (Get-Command python.exe -ErrorAction Stop).Source
    $script = Join-Path $root 'server.py'
    $stdout = Join-Path $root 'server.log'
    $stderr = Join-Path $root 'server-error.log'
    Start-Process -FilePath $python -ArgumentList @($script) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null

    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 250
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1 | Out-Null
            Write-Host 'Service started: http://127.0.0.1:8765/'
            exit 0
        } catch {}
    }

    throw 'Service did not start. Check server-error.log.'
} catch {
    Write-Host $_.Exception.Message
    exit 1
}
