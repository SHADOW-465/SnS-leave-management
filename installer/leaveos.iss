; Simon & Sons Leave OS — office host setup.
; Build with: node scripts/build-installer.mjs
; That script runs ISCC.exe. Install Inno Setup 6 if iscc is not on the machine.
; The wizard has a Next page and a Finish page. It does not ask where to install.

#define MyAppName "Simon & Sons Leave OS"
#define MyAppVersion "0.3.0"
#define MyAppPublisher "Simon & Sons"

[Setup]
AppId={{A7B3E4C1-6D20-4F5A-9C11-0B0E05A00001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\SimonAndSons\LeaveOS
DefaultGroupName={#MyAppName}
OutputDir=..\dist\installer
OutputBaseFilename=LeaveOS-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
DisableWelcomePage=no
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=no
UninstallDisplayIcon={app}\node.exe

[Files]
Source: "..\dist\installer\payload\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autodesktop}\Leave OS"; Filename: "{app}\Leave OS.url"; Comment: "Open the Leave OS host panel"

; Post-install steps run from [Code], not [Run]. [Run] ignores a program's exit code,
; so a failed prepare or certutil used to look like a successful setup.

[UninstallRun]
Filename: "{app}\LeaveOS-service.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopLeaveOS"
Filename: "{app}\LeaveOS-service.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "UninstallLeaveOS"
Filename: "{app}\node.exe"; Parameters: """{app}\prepare-host.cjs"" --restore-power"; Flags: runhidden waituntilterminated; RunOnceId: "RestoreLeaveOSPower"
Filename: "{sys}\certutil.exe"; Parameters: "-delstore Root ""Leave OS Local CA"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveLeaveOSCert"
Filename: "{sys}\certutil.exe"; Parameters: "-delstore Root ""Leave OS"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveLeaveOSLeaf"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Leave OS"""; Flags: runhidden waituntilterminated; RunOnceId: "DeleteLeaveOSFirewall"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Leave OS HTTP"""; Flags: runhidden waituntilterminated; RunOnceId: "DeleteLeaveOSHttp"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Leave OS mDNS"""; Flags: runhidden waituntilterminated; RunOnceId: "DeleteLeaveOSMdns"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Leave OS LLMNR"""; Flags: runhidden waituntilterminated; RunOnceId: "DeleteLeaveOSLlmnr"

[UninstallDelete]
Type: files; Name: "{autodesktop}\Leave OS.lnk"
Type: files; Name: "{autodesktop}\Leave OS.url"
Type: files; Name: "{app}\power-previous.json"
Type: filesandordirs; Name: "{app}"

[Messages]
FinishedLabel=Leave OS is ready on this computer. Finish opens the control panel, which shows Running, the staff link, and a QR code.

[Code]
var
  SetupFailed: Boolean;

procedure ExitProcess(uExitCode: Cardinal);
  external 'ExitProcess@kernel32.dll stdcall';

function InstallLog: String;
begin
  Result := ExpandConstant('{commonappdata}\SimonAndSons\LeaveOS\logs\install.log');
end;

procedure Note(const Line: String);
begin
  ForceDirectories(ExtractFileDir(InstallLog));
  SaveStringToFile(InstallLog, Line + #13#10, True);
end;

procedure FailStep(const StepName, Detail: String);
begin
  SetupFailed := True;
  Log('Leave OS setup stopped during ' + StepName + '. ' + Detail);
  SuppressibleMsgBox(
    'Leave OS setup stopped during "' + StepName + '".' + #13#10 +
    Detail + #13#10 + #13#10 +
    'The log is:' + #13#10 + InstallLog,
    mbCriticalError, MB_OK, IDOK);
end;

function RunStep(const StepName, FileName, Params: String): Boolean;
var
  ResultCode: Integer;
  Cmd: String;
begin
  if not WizardSilent then
    WizardForm.StatusLabel.Caption := StepName;
  Note('');
  Note('== ' + StepName + ' ==');
  Cmd := '/d /c ""' + FileName + '" ' + Params + ' >> "' + InstallLog + '" 2>&1"';
  Result := Exec(ExpandConstant('{sys}\cmd.exe'), Cmd, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if not Result then
    ResultCode := -1;
  Note('exit ' + IntToStr(ResultCode));
  if (not Result) or (ResultCode <> 0) then
  begin
    FailStep(StepName, 'The program exited with code ' + IntToStr(ResultCode) + '.');
    Result := False;
  end;
end;

function InitializeSetup: Boolean;
begin
  SetupFailed := False;
  Result := True;
end;

procedure DeinitializeSetup;
begin
  if SetupFailed then
    ExitProcess(1);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  NodeExe, AppDir, CaPem: String;
begin
  if CurStep = ssPostInstall then
  begin
    NodeExe := ExpandConstant('{app}\node.exe');
    AppDir := ExpandConstant('{app}');
    if not RunStep('prepare-host', NodeExe, '"' + AppDir + '\prepare-host.cjs"') then
      Abort;
    if not RunStep('powercfg', ExpandConstant('{sys}\powercfg.exe'), '/change standby-timeout-ac 0') then
      Abort;
    if not RunStep('powercfg', ExpandConstant('{sys}\powercfg.exe'), '/change hibernate-timeout-ac 0') then
      Abort;
    if not RunStep('leaveos-run --prepare', NodeExe, '"' + AppDir + '\leaveos-run.cjs" --prepare') then
      Abort;
    CaPem := ExpandConstant('{commonappdata}\SimonAndSons\LeaveOS\certs\ca.pem');
    if not FileExists(CaPem) then
    begin
      Note('missing ' + CaPem);
      FailStep('verify ca.pem', 'The certificate file was not created: ' + CaPem);
      Abort;
    end;
    if not RunStep('certutil', ExpandConstant('{sys}\certutil.exe'), '-addstore -f Root "' + CaPem + '"') then
      Abort;
    if not RunStep('install-service', NodeExe, '"' + AppDir + '\install-service.cjs"') then
      Abort;
  end
  else if (CurStep = ssDone) and (not SetupFailed) then
    ShellExec('open', 'https://127.0.0.1:8443/host', '', '', SW_SHOWNORMAL, ewNoWait, ResultCode);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    Exec(ExpandConstant('{app}\LeaveOS-service.exe'), 'stop', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(ExpandConstant('{app}\LeaveOS-service.exe'), 'uninstall', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if MsgBox('Also delete Leave OS data and backups?' + #13#10 + #13#10 +
      'This removes ProgramData\SimonAndSons\LeaveOS: the database, backup files, certificates, and logs.' + #13#10 +
      'Choose No to keep that folder. The program files are removed either way.',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    begin
      DelTree(ExpandConstant('{commonappdata}\SimonAndSons\LeaveOS'), True, True, True);
    end;
  end;
end;
