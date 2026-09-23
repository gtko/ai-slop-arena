# Full local generation run: every decor prop, then the A-pose characters. Detached from any
# terminal so it survives; progress in .ai3d/batch.log. Already generated models are skipped.
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$py = Join-Path $root '.ai3d\venv\Scripts\python.exe'
$log = Join-Path $root '.ai3d\batch.log'
"=== batch start $(Get-Date -Format s)" | Out-File $log -Encoding utf8
& $py -u art-src/ai3d/make3d.py decor *>> $log
& $py -u art-src/ai3d/make3d.py chibi/apose *>> $log
"=== batch end $(Get-Date -Format s)" | Out-File $log -Append -Encoding utf8
