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

[Run]
Filename: "{app}\node.exe"; Parameters: """{app}\prepare-host.cjs"""; StatusMsg: "Saving the current power settings and preparing backups..."; Flags: runhidden waituntilterminated
Filename: "{sys}\powercfg.exe"; Parameters: "/change standby-timeout-ac 0"; StatusMsg: "Keeping the host awake on mains power..."; Flags: runhidden waituntilterminated
Filename: "{sys}\powercfg.exe"; Parameters: "/change hibernate-timeout-ac 0"; StatusMsg: "Disabling hibernate while plugged in..."; Flags: runhidden waituntilterminated
Filename: "{app}\node.exe"; Parameters: """{app}\leaveos-run.cjs"" --prepare"; StatusMsg: "Creating the certificate and the data folder..."; Flags: runhidden waituntilterminated
Filename: "{sys}\certutil.exe"; Parameters: "-addstore -f Root ""{commonappdata}\SimonAndSons\LeaveOS\certs\cert.pem"""; StatusMsg: "Trusting the local certificate on this computer..."; Flags: runhidden waituntilterminated
Filename: "{app}\node.exe"; Parameters: """{app}\install-service.cjs"""; StatusMsg: "Registering and starting the Leave OS service..."; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "{app}\node.exe"; Parameters: """{app}\prepare-host.cjs"" --restore-power"; Flags: runhidden waituntilterminated; RunOnceId: "RestoreLeaveOSPower"
Filename: "{sys}\certutil.exe"; Parameters: "-delstore Root ""Leave OS"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveLeaveOSCert"
Filename: "{sys}\sc.exe"; Parameters: "stop LeaveOS"; Flags: runhidden waituntilterminated; RunOnceId: "StopLeaveOS"
Filename: "{sys}\sc.exe"; Parameters: "delete LeaveOS"; Flags: runhidden waituntilterminated; RunOnceId: "DeleteLeaveOS"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Leave OS"""; Flags: runhidden waituntilterminated; RunOnceId: "DeleteLeaveOSFirewall"

[UninstallDelete]
Type: files; Name: "{autodesktop}\Leave OS.lnk"
Type: files; Name: "{autodesktop}\Leave OS.url"

[Messages]
FinishedLabel=Leave OS is ready on this computer. Finish opens the control panel, which shows Running, the staff link, and a QR code.

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ErrorCode: Integer;
begin
  if CurStep = ssDone then
    ShellExec('open', 'https://127.0.0.1:8443/host', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    if MsgBox('Also delete Leave OS data and backups?' + #13#10 + #13#10 +
      'This removes the folder ProgramData\SimonAndSons\LeaveOS, including employee records and backup files.' + #13#10 +
      'Choose No to keep the data and the backups folder.',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    begin
      DelTree(ExpandConstant('{commonappdata}\SimonAndSons\LeaveOS'), True, True, True);
    end;
  end;
end;
