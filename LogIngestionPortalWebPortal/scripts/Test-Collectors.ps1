#requires -Version 5.1
<#
.SYNOPSIS
    Parses every catalog collector/expression to catch PowerShell syntax errors.
.DESCRIPTION
    Dependency-free (no PSScriptAnalyzer install): uses the built-in PowerShell
    language parser. Run locally or in CI:

        pwsh -File scripts/Test-Collectors.ps1

.NOTES
    Author : Sandy Zeng

    Version history:
        1.0.0 (2026-06-19) Initial documented release; added author and version
                           history header.
        1.0.1 (2026-06-19) Reviewed with PSScriptAnalyzer for cmdlet aliases and
                           approved verbs; no alias issues found.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$categoriesDir = Join-Path $root 'catalog/categories'
$setupsPath = Join-Path $root 'catalog/setups.json'

$failures = New-Object System.Collections.Generic.List[string]

# Parses a snippet of PowerShell with the built-in language parser (no
# execution) and records any syntax errors against the given label.
function Test-PowerShell {
    param([string]$Label, [string]$Code)
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseInput($Code, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors -and $parseErrors.Count -gt 0) {
        foreach ($e in $parseErrors) {
            $failures.Add("$Label : $($e.Message)")
        }
    }
}

# Shared setup snippets.
$setups = Get-Content $setupsPath -Raw | ConvertFrom-Json
foreach ($name in $setups.PSObject.Properties.Name) {
    Test-PowerShell -Label "setup '$name'" -Code $setups.$name
}

# Field expressions / collectors.
Get-ChildItem -Path $categoriesDir -Filter *.json | ForEach-Object {
    $file = $_.Name
    $data = Get-Content $_.FullName -Raw | ConvertFrom-Json
    foreach ($field in $data.fields) {
        if ($field.expression) {
            Test-PowerShell -Label "$file '$($field.id)' expression" -Code $field.expression
        }
        if ($field.collector) {
            Test-PowerShell -Label "$file '$($field.id)' collector" -Code $field.collector
        }
        if ($field.element) {
            foreach ($el in $field.element) {
                Test-PowerShell -Label "$file '$($field.id)' element '$($el.column.name)'" -Code $el.expression
            }
        }
    }
}

if ($failures.Count -gt 0) {
    Write-Host "PowerShell syntax check failed ($($failures.Count) issue(s)):" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host 'All collectors/expressions parse cleanly.' -ForegroundColor Green
