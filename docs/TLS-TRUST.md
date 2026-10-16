# Trusting Leave OS on staff computers

Trust is one click.

On a staff computer, open the address on the host panel. That is `http://sns-leave` when
port 80 is free. If something else is already using port 80, the panel shows
`http://sns-leave:8080` instead.

The page checks whether this computer already trusts Leave OS. When it does, the browser
goes straight to `https://sns-leave:8443`. When it does not, the page shows **Set up this
computer**.

1. Click **Set up this computer**.
2. If the browser asks, keep the file, then open `Set-up-this-computer.cmd`.
3. Leave OS opens.

The file runs `certutil -user -addstore Root` and imports the office root certificate into
the current user's Trusted Root store. An administrator password is not required. The
private key stays on the office computer. Do not copy `ca-key.pem` or `key.pem`.

Do not continue past a certificate warning. A warning means this computer has not trusted
the office certificate yet. Run the setup file, then open the site again.

The same root stays trusted when the office certificate is renewed, and when the LAN
address or the office name changes. Staff do not repeat the click for those changes.

## What the office computer stores

```
%PROGRAMDATA%\SimonAndSons\LeaveOS\certs\ca.pem
%PROGRAMDATA%\SimonAndSons\LeaveOS\certs\ca-key.pem
%PROGRAMDATA%\SimonAndSons\LeaveOS\certs\cert.pem
%PROGRAMDATA%\SimonAndSons\LeaveOS\certs\key.pem
```

`ca.pem` is the local root. `cert.pem` is the certificate the site presents. It is signed
by that root. The names on it are `sns-leave`, `sns-leave.local`, `localhost`, this
computer's name, `127.0.0.1`, and the current LAN addresses. The service writes a new
`cert.pem` at startup when those addresses have changed. `ca-key.pem` is not in git.

Setup trusts `ca.pem` on the office computer itself. The desktop shortcut opens
`https://127.0.0.1:8443/host`.

DW-13 stays open until the company decides whether an internal certificate authority
already exists. This root is the one Leave OS creates for the office.

## Replace the root

Stop the service, delete `ca.pem` and `ca-key.pem`, and start the service. Staff computers
trust the new root by opening the setup page again. Deleting only `cert.pem` and `key.pem`
writes a new site certificate under the same root. Staff do not click setup again for that.

## HTTP

The setup page is plain HTTP so a computer can download the trust file before it trusts
the certificate. Leave OS itself stays on HTTPS. The app is served over HTTP only when
`LEAVEOS_HTTP_FALLBACK=true` is set for the service (or `httpFallback` is true in
`config.json`). Setting `LEAVEOS_TLS_ENABLED=true` keeps HTTPS even if the fallback flag
is also set.
