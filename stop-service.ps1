$script = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'server.py'))
$pattern = [regex]::Escape($script)
$processes = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -in @('python.exe', 'pythonw.exe') -and $_.CommandLine -match $pattern
}

if (-not $processes) {
    Write-Host 'No service process for this project was found.'
    exit 0
}

$processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host 'Service stopped.'
