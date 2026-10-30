$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$archivePath = Join-Path (Split-Path -Parent $projectRoot) 'PayFlow-Entrega.zip'
$stagingPath = Join-Path $env:TEMP ('payflow-package-' + [guid]::NewGuid().ToString('N'))
$excludedDirectories = '(?:^|[\\/])(?:node_modules|dist|coverage|\.git|\.vite|\.cache|build|out)(?:[\\/]|$)'

New-Item -ItemType Directory -Path $stagingPath | Out-Null

try {
    $files = Get-ChildItem -LiteralPath $projectRoot -File -Recurse -Force | Where-Object {
        $relativePath = $_.FullName.Substring($projectRoot.Length + 1)
        $fileName = $_.Name

        $relativePath -notmatch $excludedDirectories -and
        $relativePath -notmatch '(^|[\\/])apps[\\/]api[\\/]prisma[\\/]dev\.db$' -and
        $relativePath -notmatch '\.tsbuildinfo$' -and
        $fileName -ne '.env' -and
        $fileName -notmatch '^\.env\.(?!example$)' -and
        $fileName -notmatch '\.(pem|key|p12|pfx)$' -and
        $fileName -notmatch '(^|\.)secrets?\.(json|ya?ml)$'
    }

    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($projectRoot.Length + 1)
        $stagedFile = Join-Path $stagingPath $relativePath
        $stagedDirectory = Split-Path -Parent $stagedFile

        New-Item -ItemType Directory -Path $stagedDirectory -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $stagedFile
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $stagingPath,
        $archivePath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    Add-Type -AssemblyName System.IO.Compression
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        $requiredEntries = @('.env.example', 'apps/web/.env.example', 'docs/GUIA_COMPLETO.md')
        $missingEntries = @($requiredEntries | Where-Object { $entries -notcontains $_ })
        $containsSecrets = $entries -contains '.env' -or @($entries | Where-Object { $_ -match '(^|/)node_modules/' }).Count -gt 0

        if ($missingEntries.Count -gt 0 -or $containsSecrets) {
            throw "Verificacao do ZIP falhou. Arquivos ausentes: $($missingEntries -join ', ')."
        }

        Write-Host "ZIP pronto: $archivePath" -ForegroundColor Green
        Write-Host "Arquivos: $($entries.Count) | Tamanho: $((Get-Item -LiteralPath $archivePath).Length) bytes"
        Write-Host 'Templates e guia incluidos; .env local e node_modules excluidos.'
    } finally {
        $archive.Dispose()
    }
} finally {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force -ErrorAction SilentlyContinue
}