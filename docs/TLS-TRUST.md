# Trusting Leave OS on staff computers

The office host serves Leave OS over HTTPS. On first start it writes a certificate
for this computer under the data folder:

```
%PROGRAMDATA%\SimonAndSons\LeaveOS\certs\cert.pem
%PROGRAMDATA%\SimonAndSons\LeaveOS\certs\key.pem
```

The certificate names `sns-leave`, `sns-leave.local`, `localhost`, `127.0.0.1`, this
computer's name, and its LAN address. If the office name is changed, the next certificate
includes that name and `<name>.local` as well.
It is created on this computer. It is not a public certificate. DW-13 stays open until
the company decides whether an internal certificate authority already exists.

Do not ask anyone to continue past the browser warning. A warning means the certificate
is not trusted yet. Fix the trust, then open the site again.

## Install the certificate on a staff PC

1. Copy `cert.pem` from the host (a USB stick is enough). Do not copy `key.pem`.
2. Rename it to `leaveos.crt` if Windows does not offer to install a `.pem` file.
3. Double-click the file and choose **Install certificate**.
4. Choose **Local Machine** (an administrator password is required).
5. Choose **Place all certificates in the following store**.
6. Browse to **Trusted Root Certification Authorities** and finish.
7. Close the browser and open the office address again, for example `https://sns-leave.local:8443`. The IP address printed on the host panel is the fallback.

The address must be the one printed on the host panel, including `https://`. A bookmark
that still says `http://` will not match this certificate.

## This computer

The desktop shortcut opens `https://127.0.0.1:8443/host`. Setup trusts the certificate on
this computer. Install it again only if that page shows a warning.

## Replace the certificate

Stop the service, delete `cert.pem` and `key.pem`, and start the service. The next start
writes a new pair that includes the LAN address at that moment. Staff computers need the
new `cert.pem` installed again.

## HTTP

Production uses HTTPS. HTTP is only available when `LEAVEOS_HTTP_FALLBACK=true` is set
for the service (or `httpFallback` is true in `config.json`). Use that only while
certificates are being installed, and turn it off afterwards. Setting
`LEAVEOS_TLS_ENABLED=true` keeps HTTPS even if the fallback flag is also set.
