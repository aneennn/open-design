param(
  [ValidateSet("win")]
  [string]$Platform = "win",
  [ValidateSet("hosted", "self-hosted")]
  [string]$Lane = "self-hosted",
  [string]$Namespace = "release-beta-win",
  [string]$Root = "",
  [string]$ReleaseVersion = "",
  [string]$MetadataUrl = "https://releases.open-design.ai/beta/latest/metadata.json"
)

$ErrorActionPreference = "Stop"

if ($Platform -ne "win") {
  throw "build-beta.ps1 currently supports win only"
}

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$fnm = "C:\Users\runner\.cargo\bin\fnm.exe"
$cargo = "C:\Users\runner\.cargo\bin\cargo.exe"
$makensis = "C:\Program Files (x86)\NSIS\makensis.exe"

function Require-File([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Name is required at $Path"
  }
}

function Invoke-Node24([string[]]$Arguments, [string]$WorkingDirectory = $workspaceRoot) {
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $fnm exec --using=24 -- @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "fnm exec failed with exit code ${LASTEXITCODE}: $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Read-GitHubOutput([string]$Path) {
  $outputs = @{}
  foreach ($line in Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue) {
    $index = $line.IndexOf("=")
    if ($index -le 0) { continue }
    $outputs[$line.Substring(0, $index)] = $line.Substring($index + 1)
  }
  return $outputs
}

if ([string]::IsNullOrWhiteSpace($Root)) {
  if ($Lane -eq "self-hosted") {
    $Root = "C:\.tmp\runner\od-beta"
  } else {
    $Root = Join-Path $env:RUNNER_TEMP "od-beta"
  }
}

$platformRoot = Join-Path $Root $Platform
$toolsPackDir = Join-Path $platformRoot "tools-pack"
$cacheDir = Join-Path $platformRoot "tools-pack-cache"
$reportDir = Join-Path $platformRoot "release-report"
$indexDir = Join-Path $platformRoot "index"
$buildJsonPath = Join-Path $platformRoot "windows-tools-pack-build.json"
$indexPath = Join-Path $indexDir "index.json"
$summaryPath = Join-Path $platformRoot "summary.md"
$metadataOutputPath = Join-Path $platformRoot "metadata.outputs"

New-Item -ItemType Directory -Force -Path $platformRoot, $toolsPackDir, $cacheDir, $reportDir, $indexDir | Out-Null

Require-File $fnm "fnm"
Require-File $cargo "cargo"
Require-File $makensis "makensis"

git --version
git lfs version
& $fnm exec --using=24 -- node --version
& $fnm exec --using=24 -- pnpm.cmd --version
& $cargo --version
& $makensis /VERSION

git fetch --tags --force --depth=1 origin

if ([string]::IsNullOrWhiteSpace($ReleaseVersion)) {
  $previousMetadataUrl = $env:OPEN_DESIGN_BETA_METADATA_URL
  $previousGitHubOutput = $env:GITHUB_OUTPUT
  try {
    $env:OPEN_DESIGN_BETA_METADATA_URL = $MetadataUrl
    $env:GITHUB_OUTPUT = $metadataOutputPath
    Remove-Item -LiteralPath $metadataOutputPath -Force -ErrorAction SilentlyContinue
    Invoke-Node24 -Arguments @("node", "--experimental-strip-types", ".\scripts\release-beta.ts")
    $metadata = Read-GitHubOutput $metadataOutputPath
    $ReleaseVersion = [string]$metadata["beta_version"]
  } finally {
    $env:OPEN_DESIGN_BETA_METADATA_URL = $previousMetadataUrl
    $env:GITHUB_OUTPUT = $previousGitHubOutput
  }
}

if ([string]::IsNullOrWhiteSpace($ReleaseVersion)) {
  throw "failed to resolve beta release version"
}

$outputNamespaceRoot = Join-Path $toolsPackDir "out\win\namespaces\$Namespace"
$runtimeNamespaceRoot = Join-Path $toolsPackDir "runtime\win\namespaces\$Namespace"
Remove-Item -LiteralPath $outputNamespaceRoot, $runtimeNamespaceRoot -Recurse -Force -ErrorAction SilentlyContinue

$buildArgs = @(
  "pnpm.cmd", "exec", "tools-pack", "win", "build",
  "--dir", $toolsPackDir,
  "--cache-dir", $cacheDir,
  "--namespace", $Namespace,
  "--portable",
  "--app-version", $ReleaseVersion,
  "--to", "all",
  "--json"
)

$buildOutput = & $fnm exec --using=24 -- @buildArgs
if ($LASTEXITCODE -ne 0) {
  throw "tools-pack win build failed with exit code $LASTEXITCODE"
}
$buildOutput | Set-Content -Path $buildJsonPath -Encoding utf8

$env:OD_PACKAGED_E2E_BUILD_JSON_PATH = $buildJsonPath
$env:OD_PACKAGED_E2E_WIN = "1"
$env:OD_PACKAGED_E2E_WIN_VERIFY_REINSTALL = "0"
$env:OD_PACKAGED_E2E_NAMESPACE = $Namespace
$env:OD_PACKAGED_E2E_RELEASE_CHANNEL = "beta"
$env:OD_PACKAGED_E2E_RELEASE_VERSION = $ReleaseVersion
$env:OD_PACKAGED_E2E_REPORT_DIR = Join-Path $reportDir "win"
$env:OD_PACKAGED_E2E_TOOLS_PACK_DIR = $toolsPackDir

Invoke-Node24 -Arguments @("pnpm.cmd", "exec", "tsx", "scripts/release-smoke.ts", "win", "specs/win.spec.ts") -WorkingDirectory (Join-Path $workspaceRoot "e2e")

$index = [ordered]@{
  channel = "beta"
  lane = $Lane
  namespace = $Namespace
  platform = $Platform
  releaseVersion = $ReleaseVersion
  commit = $env:GITHUB_SHA
  branch = $env:GITHUB_REF_NAME
  toolsPackDir = $toolsPackDir
  buildJsonPath = $buildJsonPath
  reportDir = $env:OD_PACKAGED_E2E_REPORT_DIR
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
}

$index | ConvertTo-Json -Depth 6 | Set-Content -Path $indexPath -Encoding utf8

$summary = @(
  "## release-beta-s",
  "",
  "- platform: ``$Platform``",
  "- lane: ``$Lane``",
  "- namespace: ``$Namespace``",
  "- releaseVersion: ``$ReleaseVersion``",
  "- index: ``$indexPath``",
  "- reportDir: ``$($env:OD_PACKAGED_E2E_REPORT_DIR)``"
)
$summary | Set-Content -Path $summaryPath -Encoding utf8

if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_STEP_SUMMARY)) {
  $summary | Add-Content -Path $env:GITHUB_STEP_SUMMARY -Encoding utf8
}

Write-Host "release-beta-s index: $indexPath"
