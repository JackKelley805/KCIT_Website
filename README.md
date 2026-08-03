# Kelley Computers website

Static website pages plus a dependency-free Node.js contact API. Node.js 18 or
newer is required.

## Local development

```bash
npm start
```

Open `http://localhost:3000`. Contact requests are written outside the website
root by default, in `../kcit-private/contact-submissions.txt`.

## Create a release ZIP

On Windows PowerShell:

```powershell
./scripts/build-release.ps1 -Version v1.0.0
```

This creates `release/kcit-site.zip`. Private submissions, Git metadata, and
development-only files are not included.

GitHub Actions also builds this file. Pushing a tag such as `v1.0.0` creates a
GitHub Release and attaches the ZIP under the stable name `kcit-site.zip`.

## Install on Linux

Install Node.js 18+, `unzip`, and `curl`, then extract the release and run:

```bash
sudo bash ./install.sh --repo OWNER/REPOSITORY
```

The repository argument is optional, but enables automatic latest-release
updates. The installer creates:

- application releases under `/opt/kcit-site/releases`;
- a `/opt/kcit-site/current` symlink to the active release;
- private contact data under `/var/lib/kcit-site`;
- configuration at `/etc/kcit-site.env`;
- an enabled `kcit-site.service` systemd service.

The service starts during boot and restarts automatically after a crash. Check
it with:

```bash
sudo systemctl status kcit-site
sudo journalctl -u kcit-site -f
```

The default service listens only on `127.0.0.1:3000`. Add the contents of
`deploy/openresty-contact-api.conf` to the appropriate OpenResty/Nginx server
block, then reload OpenResty.

### SMTP contact notifications

Contact requests are saved under `/var/lib/kcit-site` and sent by email through
authenticated SMTP. Put the credentials in `/etc/kcit-site.env`; never add them
to Git:

```ini
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=postmaster@your-domain.com
SMTP_PASS=your-smtp-password
SMTP_TO=you@example.com
SMTP_FROM="Kelley Computers Website <postmaster@your-domain.com>"
SMTP_TIMEOUT_MS=10000
```

Use `smtp.eu.mailgun.org` for a Mailgun domain hosted in the EU region. Port 587
uses STARTTLS; port 465 requires `SMTP_SECURE=true` and `SMTP_REQUIRE_TLS=false`.
When Nginx runs on another VM, also set `TRUSTED_PROXY_IPS` to that proxy VM's
private IP so rate limiting uses each visitor's actual forwarded address:

```ini
TRUSTED_PROXY_IPS=192.168.1.20
```

After editing the settings, restart and inspect the service:

```bash
sudo systemctl restart kcit-site
sudo journalctl -u kcit-site -n 50 --no-pager
```

## Update Linux

If a GitHub repository was configured during installation:

```bash
sudo /opt/kcit-site/current/update.sh
```

Or install a specific local/downloaded release:

```bash
sudo /opt/kcit-site/current/update.sh /path/to/kcit-site.zip
```

The updater validates and installs a versioned release. If the service cannot
start, the installer switches back to the previous working release.
