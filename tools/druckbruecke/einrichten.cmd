@echo off
rem Richtet die Lagernaut-Druckbruecke auf diesem PC ein (ohne Adminrechte):
rem  1. kopiert sie nach %LOCALAPPDATA%\Lagernaut-Druckbruecke (unabhaengig vom Projektordner)
rem  2. legt einen Autostart-Eintrag an - beim Anmelden startet sie minimiert.
rem Fuer ein Update einfach erneut ausfuehren und die Bruecke neu starten.
set "ZIEL=%LOCALAPPDATA%\Lagernaut-Druckbruecke"
set "AUTOSTART=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if not exist "%ZIEL%" mkdir "%ZIEL%"
copy /y "%~dp0druckbruecke.mjs" "%ZIEL%\druckbruecke.mjs" >nul || goto fehler
copy /y "%~dp0laufen.cmd" "%ZIEL%\laufen.cmd" >nul || goto fehler
> "%AUTOSTART%\Lagernaut-Druckbruecke.cmd" echo @start "Lagernaut-Druckbruecke" /min "%ZIEL%\laufen.cmd"
if errorlevel 1 goto fehler
echo Eingerichtet:
echo   Bruecke:   %ZIEL%
echo   Autostart: %AUTOSTART%\Lagernaut-Druckbruecke.cmd
echo Die Einstellungen bleiben in %USERPROFILE%\.lagernaut-druckbruecke.json
exit /b 0
:fehler
echo FEHLER beim Einrichten.
exit /b 1
