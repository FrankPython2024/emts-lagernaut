@echo off
rem Lagernaut-Druckbruecke dauerhaft laufen lassen (Autostart).
rem Startet die Bruecke und nach einem Absturz nach 10 s neu - aber NICHT,
rem wenn Einstellungen fehlen (Code 2) oder sie schon laeuft (Code 3).
title Lagernaut-Druckbruecke - bitte offen lassen
cd /d "%~dp0"
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
:neu
"%NODE%" "%~dp0druckbruecke.mjs"
set CODE=%errorlevel%
if "%CODE%"=="2" goto ende
if "%CODE%"=="3" goto ende
echo.
echo Druckbruecke beendet (Code %CODE%) - Neustart in 10 Sekunden ...
rem Warten per ping statt timeout.exe: timeout bricht sofort ab, wenn das
rem Fenster keine echte Tastatureingabe hat - dann liefe ein Absturz im Kreis.
"%SystemRoot%\System32\ping.exe" -n 11 127.0.0.1 >nul
goto neu
:ende
echo.
echo Druckbruecke nicht gestartet (siehe Meldung oben).
pause
