# Direct DNS-Only Host Cutover (`direct.watchbilm.org`)

This runbook applies the hybrid cutover:

- Keep `watchbilm.org` and `www.watchbilm.org` proxied in Cloudflare.
- Add `direct.watchbilm.org` as DNS-only (gray cloud) to reach origin directly.

## Current origin targets (from Fly)

- `A`: `66.241.124.144`
- `AAAA`: `2a09:8280:1::dd:3637:0`

## One-time origin TLS setup

The Fly certificate for `direct.watchbilm.org` has been created:

```powershell
flyctl certs add direct.watchbilm.org -a bilm
```

Check validation status:

```powershell
flyctl certs check direct.watchbilm.org -a bilm
```

## Cloudflare DNS upsert

Use a token that has **Zone DNS Edit** for `watchbilm.org`:

```powershell
$env:CF_DNS_API_TOKEN = '<cloudflare-dns-edit-token>'
.\scripts\cloudflare-upsert-direct-dns.ps1
```

This script creates/updates:

- `A direct.watchbilm.org -> 66.241.124.144` (DNS-only, TTL 300)
- `AAAA direct.watchbilm.org -> 2a09:8280:1::dd:3637:0` (DNS-only, TTL 300)

## Verification

```powershell
.\scripts\verify-direct-host.ps1
```

It checks:

- DNS propagation via `1.1.1.1` and `8.8.8.8`
- TLS certificate details on `direct.watchbilm.org:443`
- Core routes: `/`, `/movies/`, `/tv/`, `/settings/`

## Notes

- DNS-only traffic bypasses Cloudflare WAF/Bot controls.
- Proxied protections remain for `watchbilm.org` and `www.watchbilm.org`.
- If school/network filtering still blocks, submit whitelist/recategorization requests for both main and direct hostnames.
