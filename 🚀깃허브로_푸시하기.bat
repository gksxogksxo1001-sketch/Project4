@echo off
chcp 65001 > nul
title GitHub Project4 Push
echo ========================================================
echo   GitHub Project4 저장소로 푸시를 진행합니다!
echo ========================================================
set "PATH=C:\Users\User\mingit\cmd;C:\Users\User\mingit\mingw64\bin;%PATH%"
cd /d "d:\한태\daily"
echo.
echo [1/2] 로컬 커밋 상태 확인 완료
echo.
echo [2/2] 원격 저장소(origin main)로 푸시 시작...
echo (브라우저 로그인 팝업이 뜨면 [Sign in with your browser] - [Authorize]를 눌러주세요!)
echo.
"C:\Users\User\mingit\cmd\git.exe" push -u origin main
echo.
if %ERRORLEVEL% equ 0 (
    echo ========================================================
    echo   성공적으로 깃허브에 커밋/푸시가 완료되었습니다! 🎉
    echo   GitHub 웹 페이지를 새로고침(F5)해보세요!
    echo ========================================================
) else (
    echo --------------------------------------------------------
    echo   푸시 중 오류가 발생했거나 취소되었습니다.
    echo --------------------------------------------------------
)
echo.
pause
