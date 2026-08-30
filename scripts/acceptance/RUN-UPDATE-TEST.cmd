@echo off
rem Pure ASCII on purpose, and no codepage switching. cmd.exe locates lines
rem in a batch file by byte offset, so multi-byte UTF-8 text desynchronises
rem the parser and silently drops menu entries. All localized text lives in
rem update-test-menu.ps1, which PowerShell renders correctly.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-test-menu.ps1"
