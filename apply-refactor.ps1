# =============================================
# VOODO ERP - Apply Fable 5 Refactor
# Double-click or right-click > Run with PowerShell
# =============================================

$zipPath  = "C:\Users\lenovo\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\7d36fb7d-14fd-4a72-ae0c-af0b87cdbe73\048a4eb4-6fb3-4aec-847e-76de51fbd56c\local_71f38989-e432-47c2-a906-9fc57422bc5d\outputs\voodo-erp-refactored.zip"
$mdPath   = "C:\Users\lenovo\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\7d36fb7d-14fd-4a72-ae0c-af0b87cdbe73\048a4eb4-6fb3-4aec-847e-76de51fbd56c\local_71f38989-e432-47c2-a906-9fc57422bc5d\outputs\CLAUDE.md"
$tempDir  = "C:\Users\lenovo\AppData\Local\Temp\voodo-refactor"
$projDir  = "C:\Projects\voodo-erp"

Write-Host ""
Write-Host "=== VOODO ERP Refactor ===" -ForegroundColor Cyan

# --- Check zip exists ---
if (-not (Test-Path $zipPath)) {
    Write-Host "ERROR: Zip not found at:" -ForegroundColor Red
    Write-Host $zipPath
    Read-Host "Press Enter to exit"
    exit 1
}

# --- Extract zip ---
Write-Host "1. Extracting zip..." -ForegroundColor Yellow
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force
Write-Host "   Done." -ForegroundColor Green

# --- Copy JS modules ---
Write-Host "2. Copying JS modules..." -ForegroundColor Yellow
$jsSource = Join-Path $tempDir "src\js"
$jsDest   = Join-Path $projDir "src\js"
if (Test-Path $jsSource) {
    Copy-Item "$jsSource\*" $jsDest -Recurse -Force
    Write-Host "   Done." -ForegroundColor Green
} else {
    Write-Host "   WARNING: No src\js folder in zip!" -ForegroundColor Red
}

# --- Copy CLAUDE.md ---
Write-Host "3. Copying CLAUDE.md..." -ForegroundColor Yellow
if (Test-Path $mdPath) {
    Copy-Item $mdPath $projDir -Force
    Write-Host "   Done." -ForegroundColor Green
} else {
    Write-Host "   WARNING: CLAUDE.md not found, skipping." -ForegroundColor DarkYellow
}

# --- Git operations ---
Write-Host "4. Committing and pushing..." -ForegroundColor Yellow
Set-Location $projDir
git add -A
git commit -m "refactor: split app.js into feature modules + CLAUDE.md"
git push

Write-Host ""
Write-Host "=== All done! Check GitHub Actions for deployment ===" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to close"
