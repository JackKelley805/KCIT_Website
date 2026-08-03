[CmdletBinding()]
param(
    [string]$Version = "local"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $projectRoot "release"
$stageRoot = Join-Path $outputDirectory "stage"
$packageRoot = Join-Path $stageRoot "kcit-site"
$archivePath = Join-Path $outputDirectory "kcit-site.zip"

if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}

New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

$releaseItems = @(
    "assets", "styles", "scripts", "deploy",
    "index.html", "business-it.html", "managed-networks.html", "contact.html",
    "contact-development.html", "under-development.html", "server.js", "package.json", "package-lock.json",
    "robots.txt", "sitemap.xml",
    "install.sh", "update.sh", "README.md"
)

foreach ($item in $releaseItems) {
    $source = Join-Path $projectRoot $item
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Required release item is missing: $item"
    }
    Copy-Item -LiteralPath $source -Destination $packageRoot -Recurse -Force
}

Set-Content -LiteralPath (Join-Path $packageRoot "VERSION") -Value $Version -Encoding ascii
node --check (Join-Path $packageRoot "server.js")

# Compress-Archive on Windows can store backslashes in entry names. Build the
# archive directly so Linux unzip always receives portable forward-slash paths.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archiveStream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::CreateNew)
try {
    $archive = New-Object System.IO.Compression.ZipArchive(
        $archiveStream,
        [System.IO.Compression.ZipArchiveMode]::Create,
        $false
    )
    try {
        Get-ChildItem -LiteralPath $packageRoot -File -Recurse | ForEach-Object {
            $relativePath = $_.FullName.Substring($stageRoot.Length).TrimStart("\", "/")
            $entryName = $relativePath.Replace("\", "/")
            $entry = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $_.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
            $unixMode = if ($_.Extension -eq ".sh") { 33261 } else { 33188 }
            $entry.ExternalAttributes = $unixMode -shl 16
        }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    $archiveStream.Dispose()
}
Remove-Item -LiteralPath $stageRoot -Recurse -Force

Write-Host "Created $archivePath"
