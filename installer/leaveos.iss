; Simon & Sons Leave OS — office host setup.
; Build with: node scripts/build-installer.mjs
; That script runs ISCC.exe. Install Inno Setup 6 if iscc is not on the machine.

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
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\node.exe

[Files]
Source: "..\dist\installer\payload\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autodesktop}\Leave OS"; Filename: "{app}\Leave OS.url"; Comment: "Open the Leave OS host panel"

[Run]
Filename: "{app}\node.exe"; Parameters: """{app}\install-service.cjs"""; StatusMsg: "Registering the Leave OS service..."; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "{sys}\sc.exe"; Parameters: "stop LeaveOS"; Flags: runhidden; RunOnceId: "StopLeaveOS"
Filename: "{sys}\sc.exe"; Parameters: "delete LeaveOS"; Flags: runhidden; RunOnceId: "DeleteLeaveOS"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Leave OS"""; Flags: runhidden; RunOnceId: "DeleteLeaveOSFirewall"
