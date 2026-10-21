# Office host installer

The office machine runs Leave OS as a Windows service. Staff use a browser on the LAN.
The setup program is built on a Windows machine that has Inno Setup 6.

## Install the compiler

1. Download Inno Setup 6 from <https://jrsoftware.org/isdl.php> and install it.
2. `ISCC.exe` is usually in one of these folders:
   - `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`
   - `C:\Program Files\Inno Setup 6\ISCC.exe`
   - `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`
3. Optional: add that folder to PATH, or set the `ISCC` environment variable to the full path of `ISCC.exe`.

## Build

From the repository root, on 64-bit Windows, with Node 24:

```
node scripts/build-installer.mjs
```

The script stops immediately, with the install link above, when `iscc` cannot be found.
When the compiler is present it:

1. Builds the web app.
2. Bundles the server and a portable Node runtime into `dist/installer/payload`.
3. Compiles `installer/leaveos.iss`.

The setup program is written to:

```
dist\installer\LeaveOS-Setup.exe
```

That file is not committed. It is unsigned (DW-14). Publish a checksum with it for the pilot.

## What setup does

The wizard shows Next, then the install progress, then Finish. It does not ask for a folder, a port, or a hostname.

- Copies the server, the web build, and `node.exe` under `Program Files\SimonAndSons\LeaveOS`.
- Saves the current plugged-in sleep and hibernate timeouts, then sets both to never (`powercfg /change standby-timeout-ac 0` and `hibernate-timeout-ac 0`). This runs only when the setup program is installed. Building the setup program does not change this computer's power settings. If the previous timeouts could not be read, uninstall restores 30 minutes of plugged-in sleep and leaves hibernate at never.
- Creates the backup folder `%PROGRAMDATA%\SimonAndSons\LeaveOS\backups`. Daily copies go there until an administrator changes the folder.
- Writes a local root and a site certificate into `%PROGRAMDATA%\SimonAndSons\LeaveOS\certs` and trusts the root on this computer (`certutil -addstore` of `ca.pem`). Other staff computers open the setup page. Trust is one click (`docs/TLS-TRUST.md`). A certificate warning is a defect. Do not continue past one.
- Registers a service named `LeaveOS` (display name **Simon and Sons Leave OS**) with [WinSW](https://github.com/winsw/winsw) 2.12 x64, shipped as `LeaveOS-service.exe` beside `LeaveOS-service.xml`. The service starts at boot, runs the bundled `node.exe` on `leaveos-run.cjs`, restarts if that process exits, and writes its log under `%PROGRAMDATA%\SimonAndSons\LeaveOS\logs`. Setup runs `LeaveOS-service.exe install` and `start`, then waits until the service state is Running and `https://127.0.0.1:8443/healthz` answers. Plain `node.exe` is not registered with `sc.exe` (that times out with error 1053). The host panel still uses `sc.exe` to query, start, and stop the installed service. Uninstall runs `LeaveOS-service.exe stop` and `uninstall`.
- Adds firewall rules for TCP port 8443, for the setup ports TCP 80 and 8080 (`Leave OS HTTP`), and for UDP 5353 (mDNS) and UDP 5355 (LLMNR) so staff computers can resolve the office name.
- The office name is `sns-leave` until an administrator changes it on the host panel or with `PUT /api/v1/settings/hostname`. First-time staff use `http://sns-leave` (or `http://sns-leave:8080`). After trust they use `https://sns-leave:8443` and `https://sns-leave.local:8443`. The LAN address is the fallback. A NetBIOS alias is not registered: Windows applies one only by restarting the Server service or renaming the PC. Uninstall removes the HTTP, mDNS, and LLMNR firewall rules with the TCP 8443 rule.
- Puts a **Leave OS** shortcut on the desktop. It opens `https://127.0.0.1:8443/host`. That address is the host panel on this computer. It is not the staff setup link, and it does not change when port 80 is taken.
- Finish opens that same control panel. When the service is up, the page shows **Running**, the staff link, and a QR code.
- The first administrator is created on this computer: the host panel links to the first-run page while no administrator exists. Another computer on the network gets "Create the first administrator on the office computer that runs Leave OS." The sample organisation cannot be loaded in an office installation, because its accounts share a published password.
- Each of those steps is checked. Setup runs them in order: prepare the host, set the plugged-in power timeouts, create the certificate (`leaveos-run.cjs --prepare`), confirm `ca.pem` exists, trust that file with `certutil`, then register and start the service. Output is appended to `%PROGRAMDATA%\SimonAndSons\LeaveOS\logs\install.log`. If a program exits non-zero, or `ca.pem` is missing, setup shows the step name and that log path (the message is skipped in silent mode) and exits with code 1. It does not open the host panel after a failed step.

The service runs `leaveos-run.cjs`, which binds all interfaces in production on port 8443
and serves HTTPS. It tries port 80 for the staff setup page. If that listen fails with
`EADDRINUSE` or `EACCES` (Windows `http.sys` reports one of those), it listens on 8080
and logs the address it opened. The host panel, the setup page, and `/api/v1/host/status`
use that address: `http://sns-leave` when 80 opened, `http://sns-leave:8080` when it did
not. The app itself is HTTP only when `LEAVEOS_HTTP_FALLBACK=true`.
Data stays in `%PROGRAMDATA%\SimonAndSons\LeaveOS`.

Uninstall stops and removes the service (`LeaveOS-service.exe stop` and `uninstall`), removes the firewall rules (including `Leave OS HTTP`), removes the desktop shortcut, removes this computer's trust for the Leave OS root, and restores the saved power timeouts. It then deletes `power-previous.json` and the program folder `Program Files\SimonAndSons\LeaveOS`.

It keeps `%PROGRAMDATA%\SimonAndSons\LeaveOS` unless the person uninstalling chooses to delete it. That folder holds the database, the backup files, the certificates, the service logs, and `logs\install.log`. Logs and certificates are not removed on their own. The delete question defaults to No. Choosing Yes removes the whole folder, including the database.
