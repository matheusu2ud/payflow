$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $nodeDirectories = @(
        (Join-Path $env:ProgramFiles 'nodejs'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs')
    )
    $nodeDirectory = $nodeDirectories | Where-Object { Test-Path (Join-Path $_ 'node.exe') } | Select-Object -First 1

    if ($nodeDirectory) {
        $env:PATH = "$nodeDirectory;$env:PATH"
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20+ e npm nao foram encontrados. Instale o Node.js e abra novamente o PowerShell.'
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
}
if (-not (Test-Path ".\apps\web\.env")) {
    Copy-Item ".\apps\web\.env.example" ".\apps\web\.env"
}

Write-Host "Instalando dependencias..." -ForegroundColor Cyan
npm install

Write-Host "Iniciando backend e frontend em terminais separados..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectRoot'; npm run dev --workspace @payflow/api"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$projectRoot'; npm run dev --workspace @payflow/web"

Write-Host "Servicos iniciados. Configure as credenciais nos arquivos .env locais." -ForegroundColor Green
Write-Host "API: http://localhost:3333/health" -ForegroundColor Yellow
Write-Host "Web: http://localhost:5173 (ou porta informada pelo Vite)" -ForegroundColor Yellow
