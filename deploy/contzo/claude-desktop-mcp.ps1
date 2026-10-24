# Adds the forecraft MCP server to Claude Desktop, pointed at the deployed app.
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\newme\forecraft\deploy\contzo\claude-desktop-mcp.ps1
#
# Claude Desktop keeps its config in memory and writes it back whenever a preference changes, so
# the file can only be edited while the app is closed. And everything started from inside Claude
# (its Terminal panel, Claude Code) runs in a Windows job that dies with the app. So this works in
# two steps:
#   1. (here, anywhere) ask for the API key at a hidden prompt and keep it, DPAPI-encrypted for
#      this Windows user only, in %TEMP%; then hand step 2 to Explorer, outside Claude's job.
#   2. (-Apply, its own window) read and delete the key file, close Claude Desktop, write the
#      config, close any instance that started meanwhile, start Claude Desktop, check the entry.
# Each step is logged (never the key) to %TEMP%\forecraft-claude-desktop-mcp.log.
param(
  [switch]$Apply,
  [string]$Url = "https://forecraft.contzo.lol",
  [string]$Config = ""
)
$ErrorActionPreference = "Stop"
$log = Join-Path $env:TEMP "forecraft-claude-desktop-mcp.log"
$keyFile = Join-Path $env:TEMP "forecraft-claude-desktop-mcp.key"
function Say([string]$msg) {
  Write-Host $msg
  Add-Content -Path $log -Encoding utf8 -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff') $msg"
}

# The desktop app itself (Store or classic install), not the Claude Code CLI processes.
function Get-ClaudeDesktop {
  Get-Process -Name claude -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "*\WindowsApps\Claude_*" -or $_.Path -like "*\AnthropicClaude\*" }
}
function Close-ClaudeDesktop([int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    Get-ClaudeDesktop | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 200
  } while ((Get-ClaudeDesktop) -and (Get-Date) -lt $deadline)
  Say "  Claude Desktop processes left: $(@(Get-ClaudeDesktop).Count)"
}
function Find-Config {
  if ($Config) { return $Config }
  $candidates = @(
    (Get-ChildItem "$env:LOCALAPPDATA\Claude-Data" -Filter claude_desktop_config.json -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName),
    "$env:APPDATA\Claude\claude_desktop_config.json"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if (-not $candidates) { throw "No claude_desktop_config.json found; pass -Config <path>." }
  return @($candidates)[0]
}
function Test-Entry([string]$path) {
  $c = Get-Content -Raw -Path $path | ConvertFrom-Json
  return [bool]($c.mcpServers -and $c.mcpServers.forecraft -and $c.mcpServers.forecraft.env.FORECRAFT_URL -eq $Url)
}

# ---- step 1: the key, then hand off ---------------------------------------------------------
if (-not $Apply) {
  try {
    Say "---- step 1"
    $secure = Read-Host "forecraft API key (fc_live_...)" -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
    if ($plain -notmatch '^fc_live_') { throw "That does not look like a forecraft key (fc_live_...)." }
    Say "key read (fc_live_..., $($plain.Length) chars)"
    Set-Content -Path $keyFile -Encoding ascii -Value (ConvertTo-SecureString $plain -AsPlainText -Force | ConvertFrom-SecureString)
    $plain = $null
    $launcher = Join-Path $env:TEMP "forecraft-claude-desktop-mcp.cmd"
    $psArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Apply -Url `"$Url`""
    if ($Config) { $psArgs += " -Config `"$Config`"" }
    Set-Content -Path $launcher -Encoding ascii -Value "@echo off`r`npowershell $psArgs`r`n"
    Read-Host "Claude Desktop will close and reopen by itself. Press Enter to go (Ctrl+C cancels)" | Out-Null
    & explorer.exe $launcher
    Say "step 2 handed to Explorer"
  } catch {
    Say "FAILED: $($_.Exception.Message)"
    Remove-Item $keyFile -ErrorAction SilentlyContinue
  }
  return
}

# ---- step 2: close, write, reopen -----------------------------------------------------------
try {
  Say "---- step 2"
  $Config = Find-Config
  Say "config: $Config"
  if (-not (Test-Path $keyFile)) { throw "No key from step 1; run the script without -Apply." }
  $secure = Get-Content -Raw $keyFile | ForEach-Object { $_.Trim() } | ConvertTo-SecureString
  Remove-Item $keyFile
  $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  $node = (Get-Command node -ErrorAction Stop).Source
  $server = Join-Path (Resolve-Path "$PSScriptRoot\..\..") "packages\mcp\index.mjs"

  Start-Sleep -Seconds 2
  $relaunch = [bool](Get-ClaudeDesktop)
  if ($relaunch) { Say "closing Claude Desktop"; Close-ClaudeDesktop 15 }

  Copy-Item $Config "$Config.bak" -Force
  # Node edits the JSON so every other setting is kept exactly; the key travels by env, not argv.
  $env:FC_CONFIG = $Config; $env:FC_NODE = $node; $env:FC_SERVER = $server; $env:FC_URL = $Url; $env:FC_KEY = $key
  # (A script file, not `node -e`: PowerShell 5.1 strips the double quotes from native arguments.)
  $js = Join-Path $env:TEMP "forecraft-claude-desktop-mcp.cjs"
  Set-Content -Path $js -Encoding ascii -Value @'
const fs = require("fs");
const p = process.env.FC_CONFIG;
const c = JSON.parse(fs.readFileSync(p, "utf8"));
c.mcpServers = c.mcpServers || {};
c.mcpServers.forecraft = {
  command: process.env.FC_NODE,
  args: [process.env.FC_SERVER],
  env: { FORECRAFT_URL: process.env.FC_URL, FORECRAFT_API_KEY: process.env.FC_KEY },
};
fs.writeFileSync(p, JSON.stringify(c, null, 2) + "\n");
'@
  & $node $js
  $rc = $LASTEXITCODE
  Remove-Item Env:FC_KEY, $js
  if ($rc -ne 0) { throw "Could not write $Config (backup at $Config.bak)." }
  Say "config written; entry present: $(Test-Entry $Config)"

  # An instance that started while we wrote has the old config in memory and would write it
  # back later: close it too, so the next start reads the file from disk.
  if (Get-ClaudeDesktop) { Say "an instance started meanwhile; closing it"; Close-ClaudeDesktop 15 }
  if (-not (Test-Entry $Config)) { throw "The entry vanished before Claude Desktop restarted; run this again." }
  $app = Get-StartApps | Where-Object { $_.AppID -like "Claude_*!Claude" } | Select-Object -First 1
  if ($app) { Start-Process "shell:AppsFolder\$($app.AppID)"; Say "Claude Desktop started" } else { Say "Start Claude Desktop again." }
  Start-Sleep -Seconds 20
  Say "20s after start, entry present: $(Test-Entry $Config)"
  Say "done"
} catch {
  Say "FAILED: $($_.Exception.Message)"
} finally {
  Remove-Item $keyFile -ErrorAction SilentlyContinue
  Read-Host "Press Enter to close this window" | Out-Null
}
