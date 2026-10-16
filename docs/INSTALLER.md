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
- Writes the local HTTPS certificate into `%PROGRAMDATA%\SimonAndSons\LeaveOS\certs` and trusts it on this computer (`certutil -addstore`). Other staff computers still follow `docs/TLS-TRUST.md`. A certificate warning is a defect. Do not continue past one.
- Registers a service named `LeaveOS` that starts at boot, starts it, and waits until `https://127.0.0.1:8443/healthz` answers. Registration uses `node-windows` when that package is present, and otherwise `sc.exe` (the same registrar as `scripts/service.mjs`). NSSM is not required.
- Adds a firewall rule for TCP port 8443.
- Puts a **Leave OS** shortcut on the desktop. It opens `https://127.0.0.1:8443/host`.
- Finish opens that same control panel. When the service is up, the page shows **Running**, the staff link, and a QR code.

The service runs `leaveos-run.cjs`, which binds all interfaces in production on port 8443
and serves HTTPS. HTTP is only used when `LEAVEOS_HTTP_FALLBACK=true`.
Data stays in `%PROGRAMDATA%\SimonAndSons\LeaveOS`.

Uninstall stops and removes the service, removes the firewall rule, removes the desktop shortcut, removes this computer's trust for the Leave OS certificate, and restores the saved power timeouts. It keeps the data folder and the backups folder unless the person uninstalling chooses to delete them. The delete question defaults to No.
