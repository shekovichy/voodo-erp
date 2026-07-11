@echo off
REM Local test run — build.py + local server, open in browser.
REM Use this BEFORE pushing to main so code bugs get caught locally
REM instead of live on GitHub Pages / Vercel.
cd /d C:\Projects\voodo-erp
echo Building index.html from src/...
python build.py
if errorlevel 1 (
  echo Build failed — fix the error above before testing.
  pause
  exit /b 1
)
echo.
echo Starting local server at http://localhost:8765 ...
echo (Ctrl+C here stops the server when you're done testing)
start "" http://localhost:8765
python -m http.server 8765
