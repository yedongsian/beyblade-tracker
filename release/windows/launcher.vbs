Option Explicit
Dim shell, fso, root, action, mode, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
action = "open"
If WScript.Arguments.Count > 0 Then action = WScript.Arguments(0)
mode = ""
If WScript.Arguments.Count > 1 Then mode = LCase(WScript.Arguments(1))
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass"
If mode = "noninteractive" Then command = command & " -NonInteractive"
command = command & " -File """ & root & "\launcher.ps1"" -Action " & action
If mode = "noninteractive" Then command = command & " -NonInteractive"
shell.Run command, 0, False
