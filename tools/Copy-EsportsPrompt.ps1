[CmdletBinding()]
param([ValidatePattern('^0?[1-7]$')][string]$Id)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $Root 'prompts\prompt-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $Id) {
    $status = Get-Content (Join-Path $Root 'PROJECT_STATUS.md') -Raw -Encoding UTF8
    $match = [regex]::Match($status, '(?m)^- \[ \] ESP-(0[1-7])\s*$')
    if (-not $match.Success) { throw 'All seven prompts are checked. No next prompt exists.' }
    $Id = $match.Groups[1].Value
}
$normalized = 'ESP-' + $Id.PadLeft(2, '0')
$items = @($manifest.prompts | Where-Object { $_.id -eq $normalized })
if ($items.Count -ne 1) { throw "Expected one manifest entry for $normalized." }
$status = Get-Content (Join-Path $Root 'PROJECT_STATUS.md') -Raw -Encoding UTF8
foreach ($dependency in @($items[0].depends_on)) {
    if ($status -notmatch ('(?m)^- \[x\] ' + [regex]::Escape($dependency) + '\s*$')) {
        throw "$normalized requires completed $dependency. Resume the earlier prompt first."
    }
}
$content = Get-Content (Join-Path $Root $items[0].file) -Raw -Encoding UTF8
$blocks = [regex]::Matches($content, '(?s)```text\s*\r?\n(.*?)\r?\n```')
if ($blocks.Count -ne 1) { throw 'Prompt must have exactly one fenced text block.' }
$prompt = $blocks[0].Groups[1].Value.Trim()
Set-Clipboard -Value $prompt
$copyPath = Join-Path $Root '.esports-current-prompt.txt'
[System.IO.File]::WriteAllText($copyPath, $prompt + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Host "Copied $normalized to clipboard." -ForegroundColor Green
Write-Host "Backup copy: $copyPath"
Write-Host 'Paste into the coding agent. Execute only this prompt; resume the same prompt if unfinished.'
