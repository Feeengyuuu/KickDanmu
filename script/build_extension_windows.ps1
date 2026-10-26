$ErrorActionPreference = "Stop"

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$repoPrefix = $repoRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$entriesPath = Join-Path $repoRoot "frontend/chrome_extension/entries_prod.yaml"

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "package.json") -PathType Leaf) -or
    -not (Test-Path -LiteralPath $entriesPath -PathType Leaf)) {
  throw "The script must run from a DanMage source checkout."
}

function Get-RepoChildPath([string]$relativePath) {
  $fullPath = [IO.Path]::GetFullPath((Join-Path $repoRoot $relativePath))
  if (-not $fullPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to operate outside the repository: $fullPath"
  }
  return $fullPath
}

$generatedRelativePaths = @(
  "background",
  "content_script",
  "_locales",
  "image",
  "manifest.json"
)
$outputPath = Get-RepoChildPath "chrome_extension_bin"

$preexistingGeneratedPaths = @(
  $generatedRelativePaths | Where-Object {
    Test-Path -LiteralPath (Get-RepoChildPath $_)
  }
)
if ($preexistingGeneratedPaths.Count -gt 0) {
  throw "Refusing to overwrite repo-root paths used by Bundage staging: $($preexistingGeneratedPaths -join ', ')"
}

function Remove-GeneratedFiles {
  foreach ($relativePath in $generatedRelativePaths) {
    $path = Get-RepoChildPath $relativePath
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $path -Recurse -Force
    }
  }
}

$buildSucceeded = $false
Push-Location $repoRoot
try {
  if (Test-Path -LiteralPath $outputPath) {
    Remove-Item -LiteralPath $outputPath -Recurse -Force
  }

  $npxPath = (Get-Command npx.cmd -ErrorAction Stop).Source
  & $npxPath bundage bwa -ec $entriesPath -d -o $repoRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Bundage exited with code $LASTEXITCODE."
  }

  $requiredFiles = @(
    "manifest.json",
    "image/app_icon.png",
    "background/index.js",
    "content_script/index.js",
    "_locales/en/messages.json",
    "_locales/zh_CN/messages.json"
  )
  foreach ($relativePath in $requiredFiles) {
    $path = Get-RepoChildPath $relativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Bundage did not produce required file: $relativePath"
    }
  }

  New-Item -ItemType Directory -Path $outputPath | Out-Null
  Copy-Item -LiteralPath (Get-RepoChildPath "manifest.json") -Destination $outputPath
  Copy-Item -LiteralPath (Get-RepoChildPath "image") -Destination $outputPath -Recurse
  Copy-Item -LiteralPath (Get-RepoChildPath "_locales") -Destination $outputPath -Recurse

  foreach ($bundleDirectory in @("background", "content_script")) {
    $destinationDirectory = Join-Path $outputPath $bundleDirectory
    New-Item -ItemType Directory -Path $destinationDirectory | Out-Null
    Copy-Item -LiteralPath (Get-RepoChildPath "$bundleDirectory/index.js") -Destination $destinationDirectory
  }

  $buildSucceeded = $true
  Write-Host "Built unpacked Chrome extension: $outputPath"
}
finally {
  Remove-GeneratedFiles
  if (-not $buildSucceeded -and (Test-Path -LiteralPath $outputPath)) {
    Remove-Item -LiteralPath $outputPath -Recurse -Force
  }
  Pop-Location
}
