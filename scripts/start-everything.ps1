$ErrorActionPreference = 'Stop'

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Repo

$Logs = Join-Path $Repo 'logs'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

$OllamaOut = Join-Path $Logs 'ollama-out.log'
$OllamaErr = Join-Path $Logs 'ollama-error.log'
$GatewayOut = Join-Path $Logs 'autoqa-gateway-out.log'
$GatewayErr = Join-Path $Logs 'autoqa-gateway-error.log'
$CloudflareOut = Join-Path $Logs 'cloudflare-out.log'
$CloudflareErr = Join-Path $Logs 'cloudflare-error.log'

function Write-Section([string]$Text) {
    Write-Host ''
    Write-Host '============================================================'
    Write-Host $Text
    Write-Host '============================================================'
}

function Write-Step([string]$Text) {
    Write-Host $Text
}

function Find-Exe([string]$Name, [string[]]$Fallbacks) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($candidate in $Fallbacks) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }
    return $null
}

function Test-HttpOk([string]$Url, [int]$TimeoutSeconds = 4) {
    try {
        Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSeconds | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Wait-Until([scriptblock]$Check, [int]$Seconds, [int]$DelaySeconds = 2) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Check) { return $true }
        Start-Sleep -Seconds $DelaySeconds
    }
    return $false
}

function Get-Listener([int]$Port) {
    Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Get-ProcessInfo([int]$Pid) {
    Get-CimInstance Win32_Process -Filter "ProcessId = $Pid" -ErrorAction SilentlyContinue
}

function Stop-OldLauncherWatchdogs {
    $patterns = 'START-EVERYTHING(?:-ASYNC)?\.bat.*(OLLAMA-WATCH|AUTOQA-WATCH|GATEWAY-WATCH|TUNNEL-WATCH)'
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match $patterns } |
        ForEach-Object {
            try {
                Write-Step "[CLEAN] Stopping old launcher watchdog PID $($_.ProcessId)..."
                Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
            } catch {}
        }
}

function Stop-AutoQaPort([int]$Port) {
    $listener = Get-Listener $Port
    if (-not $listener) { return }

    $info = Get-ProcessInfo $listener.OwningProcess
    $name = if ($info) { $info.Name } else { '' }
    $command = if ($info) { [string]$info.CommandLine } else { '' }

    $isAutoQaNode = $name -ieq 'node.exe' -and $command -match 'autoqa[\\/](server|gateway)\.mjs'
    if (-not $isAutoQaNode) {
        throw "Port $Port is owned by PID $($listener.OwningProcess) ($name), which is not an Auto QA Node process. Close that program and run START-EVERYTHING.bat again."
    }

    Write-Step "[CLEAN] Stopping stale Auto QA PID $($listener.OwningProcess) on port $Port..."
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 700
}

function Test-Ollama {
    Test-HttpOk 'http://127.0.0.1:11434/api/tags' 3
}

function Repair-OllamaPort {
    $listener = Get-Listener 11434
    if (-not $listener) { return }

    $info = Get-ProcessInfo $listener.OwningProcess
    $name = if ($info) { [string]$info.Name } else { '' }
    $command = if ($info) { [string]$info.CommandLine } else { '' }

    if ($name -match '^ollama.*\.exe$' -or $command -match '(?i)ollama') {
        Write-Step "[CLEAN] Port 11434 has an unhealthy Ollama PID $($listener.OwningProcess). Restarting it cleanly..."
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        return
    }

    throw "Port 11434 is occupied by PID $($listener.OwningProcess) ($name), not Ollama. Auto QA will not kill an unrelated process."
}

function Show-Log([string]$Path, [int]$Tail = 80) {
    if (Test-Path $Path) {
        Get-Content $Path -Tail $Tail -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
}

Write-Section 'QA CONTROL CENTER - ONE CLICK RELIABLE AUTO QA'
Write-Step "Repo: $Repo"

$Python = Join-Path $Repo '.venv-autoqa\Scripts\python.exe'
if (-not (Test-Path $Python)) {
    throw 'Auto QA Python environment is missing. Run INSTALL-AUTO-QA.bat first.'
}

$Node = Find-Exe 'node.exe' @()
if (-not $Node) { $Node = Find-Exe 'node' @() }
if (-not $Node) { throw 'Node.js is not available in PATH.' }

$Ollama = Find-Exe 'ollama.exe' @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:LOCALAPPDATA 'Ollama\ollama.exe')
)
if (-not $Ollama) { $Ollama = Find-Exe 'ollama' @() }
if (-not $Ollama) { throw 'Ollama was not found. Install Ollama and run START-EVERYTHING.bat again.' }

$Cloudflared = Find-Exe 'cloudflared.exe' @(
    'C:\Program Files (x86)\cloudflared\cloudflared.exe',
    'C:\Program Files\cloudflared\cloudflared.exe'
)
if (-not $Cloudflared) { $Cloudflared = Find-Exe 'cloudflared' @() }
if (-not $Cloudflared) { throw 'cloudflared was not found.' }

Stop-OldLauncherWatchdogs
Start-Sleep -Seconds 1

Write-Step '[CLEAN] Freeing Auto QA ports 8788 and 8789...'
Stop-AutoQaPort 8788
Stop-AutoQaPort 8789

Write-Step '[CHECK] Ollama...'
if (Test-Ollama) {
    Write-Step '[OK] Ollama is already healthy.'
} else {
    Repair-OllamaPort
    Remove-Item $OllamaOut, $OllamaErr -Force -ErrorAction SilentlyContinue
    Write-Step '[START] Starting one clean Ollama server...'
    $ollamaProcess = Start-Process -FilePath $Ollama -ArgumentList @('serve') -WindowStyle Hidden -RedirectStandardOutput $OllamaOut -RedirectStandardError $OllamaErr -PassThru

    $ollamaReady = Wait-Until { Test-Ollama } 60 2
    if (-not $ollamaReady) {
        Write-Host '----- Ollama stdout -----'
        Show-Log $OllamaOut 80
        Write-Host '----- Ollama stderr -----'
        Show-Log $OllamaErr 80
        $listener = Get-Listener 11434
        if ($listener) {
            $info = Get-ProcessInfo $listener.OwningProcess
            Write-Host "Port 11434 owner: PID $($listener.OwningProcess) $($info.Name)"
            Write-Host "Command: $($info.CommandLine)"
        } else {
            Write-Host 'Nothing is listening on port 11434.'
        }
        throw 'Ollama did not become healthy.'
    }
    Write-Step '[OK] Ollama started successfully.'
}

$tags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
$modelNames = @($tags.models | ForEach-Object { @([string]$_.name, [string]$_.model) })
if (-not ($modelNames | Where-Object { $_ -eq 'qwen3:8b' -or $_ -like 'qwen3:8b*' })) {
    throw 'Ollama model qwen3:8b is not installed. Run: ollama pull qwen3:8b'
}
Write-Step '[OK] qwen3:8b is installed.'

$env:AUTO_QA_PYTHON = $Python
$env:AUTO_QA_OLLAMA_URL = 'http://127.0.0.1:11434'
$env:AUTO_QA_OLLAMA_MODEL = 'qwen3:8b'

Remove-Item $GatewayOut, $GatewayErr -Force -ErrorAction SilentlyContinue
Write-Step '[START] Async Auto QA gateway + worker...'
$gatewayProcess = Start-Process -FilePath $Node -ArgumentList @('autoqa\gateway.mjs') -WorkingDirectory $Repo -WindowStyle Hidden -RedirectStandardOutput $GatewayOut -RedirectStandardError $GatewayErr -PassThru

$gatewayReady = Wait-Until {
    try {
        $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8788/health' -TimeoutSec 5
        return [bool]($r.ok -and $r.gateway)
    } catch {
        return $false
    }
} 90 2

if (-not $gatewayReady) {
    Write-Host '----- Auto QA gateway stdout -----'
    Show-Log $GatewayOut 120
    Write-Host '----- Auto QA gateway stderr -----'
    Show-Log $GatewayErr 120
    throw 'Auto QA gateway did not become healthy.'
}
Write-Step '[OK] Async Auto QA gateway is healthy on http://127.0.0.1:8788'

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -match '--url\s+http://127\.0\.0\.1:8788' } |
    ForEach-Object {
        try {
            Write-Step "[CLEAN] Stopping old Auto QA Cloudflare PID $($_.ProcessId)..."
            Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        } catch {}
    }
Start-Sleep -Seconds 1

Remove-Item $CloudflareOut, $CloudflareErr -Force -ErrorAction SilentlyContinue
$PublicUrl = ''
$TunnelMode = 'QUICK'

if ($env:AUTO_QA_TUNNEL_NAME) {
    $TunnelMode = 'NAMED'
    $config = if ($env:AUTO_QA_TUNNEL_CONFIG) { $env:AUTO_QA_TUNNEL_CONFIG } else { Join-Path $HOME '.cloudflared\config.yml' }
    if (-not (Test-Path $config)) { throw "Named tunnel config was not found: $config" }
    Write-Step "[START] Named Cloudflare tunnel: $($env:AUTO_QA_TUNNEL_NAME)"
    $cfProcess = Start-Process -FilePath $Cloudflared -ArgumentList @('tunnel','--config',$config,'run',$env:AUTO_QA_TUNNEL_NAME) -WindowStyle Hidden -RedirectStandardOutput $CloudflareOut -RedirectStandardError $CloudflareErr -PassThru
    $PublicUrl = [string]$env:AUTO_QA_PUBLIC_URL
} else {
    Write-Step '[START] Cloudflare Quick Tunnel...'
    $cfProcess = Start-Process -FilePath $Cloudflared -ArgumentList @('tunnel','--url','http://127.0.0.1:8788') -WindowStyle Hidden -RedirectStandardOutput $CloudflareOut -RedirectStandardError $CloudflareErr -PassThru

    $deadline = (Get-Date).AddSeconds(70)
    while ((Get-Date) -lt $deadline -and -not $PublicUrl) {
        Start-Sleep -Seconds 2
        $text = ''
        if (Test-Path $CloudflareOut) { $text += (Get-Content $CloudflareOut -Raw -ErrorAction SilentlyContinue) }
        if (Test-Path $CloudflareErr) { $text += "`n" + (Get-Content $CloudflareErr -Raw -ErrorAction SilentlyContinue) }
        $match = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com', 'IgnoreCase')
        if ($match.Success) { $PublicUrl = $match.Value }
        if ($cfProcess.HasExited -and -not $PublicUrl) { break }
    }

    if (-not $PublicUrl) {
        Write-Host '----- Cloudflare stdout -----'
        Show-Log $CloudflareOut 100
        Write-Host '----- Cloudflare stderr -----'
        Show-Log $CloudflareErr 100
        throw 'Cloudflare did not publish a Quick Tunnel URL.'
    }

    Set-Clipboard -Value $PublicUrl
    Write-Step "[OK] Quick Tunnel URL: $PublicUrl"
    Write-Step '[INFO] Public URL copied to clipboard.'
}

if ($PublicUrl) {
    Write-Step '[CHECK] Cloudflare public health...'
    $publicReady = Wait-Until {
        try {
            $r = Invoke-RestMethod -Uri "$PublicUrl/health" -TimeoutSec 8
            return [bool]($r.ok -and $r.gateway)
        } catch {
            return $false
        }
    } 60 3

    if (-not $publicReady) {
        Write-Host '----- Cloudflare stdout -----'
        Show-Log $CloudflareOut 100
        Write-Host '----- Cloudflare stderr -----'
        Show-Log $CloudflareErr 100
        throw "Cloudflare tunnel started, but $PublicUrl/health is not healthy."
    }
    Write-Step '[OK] Cloudflare public endpoint is healthy.'
}

Write-Section 'AUTO QA READY'
Write-Host 'Local   : http://127.0.0.1:8788'
Write-Host 'Worker  : http://127.0.0.1:8789'
Write-Host 'Ollama  : http://127.0.0.1:11434'
Write-Host 'Model   : qwen3:8b'
Write-Host 'Frontend: https://qa-tool-control.netlify.app/'
Write-Host "Tunnel  : $TunnelMode"
if ($PublicUrl) { Write-Host "Public   : $PublicUrl" }
Write-Host ''
if ($TunnelMode -eq 'QUICK') {
    Write-Host 'Paste the Public URL into Admin > Auto QA > Auto QA Service URL if it changed.'
}
Write-Host 'You may lock Windows. Do not put the PC to sleep.'

Start-Process 'https://qa-tool-control.netlify.app/'
