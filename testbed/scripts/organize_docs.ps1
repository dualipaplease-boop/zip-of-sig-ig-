$base = 'c:\Users\iqand\Downloads\SIH'

# 1. Create docs and notes directories
$docsDir = Join-Path $base 'docs'
$notesDir = Join-Path $docsDir 'notes'
if (-not (Test-Path $notesDir)) {
    New-Item -ItemType Directory -Path $notesDir -Force | Out-Null
}

# 2. Move changelog and backlog to docs
$docFiles = @('CHANGELOG.md', 'BACKLOG.md')
foreach ($f in $docFiles) {
    $src = Join-Path $base $f
    if (Test-Path $src) {
        Move-Item -Path $src -Destination (Join-Path $docsDir $f) -Force
        Write-Output "Moved $f -> docs/$f"
    }
}

# 3. Move research and notes to docs/notes
$noteFiles = @(
    'SIH26171-complete-session-history.md',
    'SIH26171-problem-statement.md',
    'SIH26171-research-notes.md',
    'PS26171-research-compiled.md',
    'PS26171-techniques-to-take.md',
    'sih26171-research-links.md'
)

foreach ($f in $noteFiles) {
    $src = Join-Path $base $f
    if (Test-Path $src) {
        Move-Item -Path $src -Destination (Join-Path $notesDir $f) -Force
        Write-Output "Moved $f -> docs/notes/$f"
    }
}

Write-Output "Docs reorganization complete."
