@echo off
REM ══════════════════════════════════════════════════════════════════
REM اختبارات قواعد Firestore — بتشغّل firestore.rules الحقيقي على محاكي
REM محلي. بديل عن Rules Playground اليدوي: أسرع، بيتكرر، وميقدرش يلمس
REM الإنتاج (بيستخدم مشروع وهمي اسمه voodo-rules-test).
REM
REM شغّله قبل نشر أي تعديل على firestore.rules.
REM محتاج: Java (OpenJDK 21 متسطّب) + npm install مرة واحدة في rules-test\
REM ══════════════════════════════════════════════════════════════════
cd /d C:\Projects\voodo-erp\rules-test

if not exist node_modules (
  echo تنصيب المكتبات لأول مرة...
  call npm install
  if errorlevel 1 (
    echo فشل npm install
    pause
    exit /b 1
  )
)

REM محاكي Firestore محتاج Java في الـ PATH
if exist "C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot\bin\java.exe" (
  set "PATH=C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot\bin;%PATH%"
)

call npx firebase emulators:exec --only firestore --project voodo-rules-test "node run-tests.js"
set RESULT=%ERRORLEVEL%

echo.
if %RESULT%==0 (
  echo ✅ القواعد سليمة — ينفع تنشر
) else (
  echo ❌ فيه اختبار فشل — متنشرش
)
pause
exit /b %RESULT%
