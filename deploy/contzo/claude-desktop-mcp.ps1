# Adds the forecraft MCP server to Claude Desktop, pointed at the deployed app.
# Asks for the API key at a hidden prompt, so it never lands in chat, git or shell history.
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy\contzo\claude-desktop-mcp.ps1
# Then quit Claude Desktop from the tray and start it again.
param(
  [string]$Url = "https://forecraft.contzo.lol",
  [string]$Config = ""
)
$ErrorActionPreference = "Stop"

if (-not $Config) {
  $candidates = @(
    (Get-ChildItem "$env:LOCALAPPDATA\Claude-Data" -Filter claude_desktop_config.json -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName),
    "$env:APPDATA\Claude\claude_desktop_config.json"
  ) | Where-Object { $_ -and (Test-Path $_) }
  if (-not $candidates) { throw "No claude_desktop_config.json found; pass -Config <path>." }
  $Config = @($candidates)[0]
}
$node = (Get-Command node -ErrorAction Stop).Source
$server = Join-Path (Resolve-Path "$PSScriptRoot\..\..") "packages\mcp\index.mjs"

$secure = Read-Host "forecraft API key (fc_live_...)" -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ($key -notmatch '^fc_live_') { throw "That does not look like a forecraft key (fc_live_...)." }

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
Write-Host "forecraft added to $Config (backup: $Config.bak). Restart Claude Desktop."
