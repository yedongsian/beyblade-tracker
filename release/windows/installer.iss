#define AppVersion GetEnv('BEYBLADE_RELEASE_VERSION')
#define PayloadDir GetEnv('BEYBLADE_PAYLOAD_DIR')
#define ReleaseOutputDir GetEnv('BEYBLADE_OUTPUT_DIR')

[Setup]
AppId={{9C86A9F9-41C7-49AB-B2DE-CDAAFB1EA41E}
AppName=Beyblade Tracker
AppVersion={#AppVersion}
AppVerName=Beyblade Tracker {#AppVersion}
AppPublisher=Beyblade Tracker
DefaultDirName={localappdata}\Programs\Beyblade Tracker
DefaultGroupName=Beyblade Tracker
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#ReleaseOutputDir}
OutputBaseFilename=BeybladeTracker-{#AppVersion}-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UninstallDisplayName=Beyblade Tracker
UninstallDisplayIcon={app}\versions\{#AppVersion}\runtime\node.exe
AppMutex=BeybladeTrackerInstaller
CloseApplications=yes
RestartApplications=no
VersionInfoVersion={#AppVersion}

[Languages]
Name: "chinesetraditional"; MessagesFile: "compiler:Languages\ChineseTraditional.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[Tasks]
Name: "startup"; Description: "登入 Windows 後自動啟動背景追蹤"; GroupDescription: "背景執行："; Flags: checkedonce

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}\versions\{#AppVersion}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "launcher.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "launcher.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Beyblade Tracker"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"" open"; WorkingDir: "{app}"
Name: "{group}\匯出／移機"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"" export"; WorkingDir: "{app}"
Name: "{group}\匯入／移機"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"" import"; WorkingDir: "{app}"
Name: "{group}\停止背景追蹤"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"" stop"; WorkingDir: "{app}"
Name: "{group}\服務狀態"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\launcher.ps1"" -Action status"; WorkingDir: "{app}"

[Registry]
; Startup automation must never show a launcher dialog at logon: it runs in non-interactive mode.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "BeybladeTracker"; ValueData: """{sys}\wscript.exe"" ""{app}\launcher.vbs"" start noninteractive"; Tasks: startup; Flags: uninsdeletevalue

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"" restart"; Description: "啟動 Beyblade Tracker"; Flags: nowait runhidden; Check: not WizardSilent
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launcher.vbs"" restart noninteractive"; Description: "啟動 Beyblade Tracker"; Flags: nowait runhidden; Check: WizardSilent

[UninstallDelete]
Type: files; Name: "{app}\current.json"
Type: dirifempty; Name: "{app}"

[Code]
var
  PreserveUserData: Boolean;

function ChromeInstalled: Boolean;
begin
  Result := FileExists(ExpandConstant('{pf}\Google\Chrome\Application\chrome.exe')) or
    FileExists(ExpandConstant('{pf32}\Google\Chrome\Application\chrome.exe')) or
    FileExists(ExpandConstant('{localappdata}\Google\Chrome\Application\chrome.exe'));
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Choice, ErrorCode: Integer;
begin
  Result := True;
  if (CurPageID = wpReady) and (not WizardSilent) and (not ChromeInstalled) then begin
    Choice := MsgBox('找不到 Google Chrome。一般 HTTP 商店仍可使用，但需要瀏覽器的來源將無法掃描。是否開啟官方 Chrome 下載頁？', mbConfirmation, MB_YESNO);
    if Choice = IDYES then ShellExec('open', 'https://www.google.com/chrome/', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    SaveStringToFile(ExpandConstant('{app}\current.json'), '{"version":"{#AppVersion}"}', False);
end;

{ Stopping the service is an explicit uninstall precondition: the launcher runs hidden and
  non-interactive, so a stop failure returns a non-zero code instead of waiting for a dialog.
  A missing launcher proves only that the stop helper cannot run, never that the service stopped,
  so it fails closed: repair the install by reinstalling the same version, then uninstall again. }
function StopTrackerService(): Boolean;
var
  LauncherPath: String;
  ResultCode: Integer;
begin
  LauncherPath := ExpandConstant('{app}\launcher.ps1');
  if not FileExists(LauncherPath) then begin
    Result := False;
    exit;
  end;
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -NonInteractive -File "' + LauncherPath + '" -Action stop -NonInteractive',
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function InitializeUninstall(): Boolean;
begin
  Result := StopTrackerService();
  if not Result then begin
    SuppressibleMsgBox('無法確認背景追蹤服務已停止，因此已取消移除，以免刪除正在執行的檔案。若安裝檔案不完整，請重新安裝相同或較新版本以修復，再從開始選單停止背景追蹤後重新移除。', mbError, MB_OK, IDOK);
    exit;
  end;
  PreserveUserData := SuppressibleMsgBox('是否保留商品、歷史、設定與備份，方便日後重新安裝？' + #13#10 + #13#10 + '選「是」保留資料；選「否」會永久刪除使用者資料。', mbConfirmation, MB_YESNO, IDYES) = IDYES;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and (not PreserveUserData) then
    DelTree(ExpandConstant('{localappdata}\BeybladeTracker'), True, True, True);
end;
