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

- Copies the server, the web build, and `node.exe` under `Program Files\SimonAndSons\LeaveOS`.
- Registers a service named `LeaveOS` that starts at boot. Registration uses `node-windows` when that package is present, and otherwise `sc.exe` (the same registrar as `scripts/service.mjs`). NSSM is not required.
- Adds a firewall rule for TCP port 8443.
- Puts a **Leave OS** shortcut on the desktop. It opens `https://127.0.0.1:8443/host`.

The service runs `leaveos-run.cjs`, which binds all interfaces in production on port 8443
and serves HTTPS. The certificate is written on first start. See `docs/TLS-TRUST.md`.
HTTP is only used when `LEAVEOS_HTTP_FALLBACK=true`.
Data stays in `%PROGRAMDATA%\SimonAndSons\LeaveOS`. Uninstall removes the service and the firewall rule. It does not delete that data folder.
