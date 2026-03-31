param(
  [string]$ZoneName = 'watchbilm.org',
  [string]$HostName = 'direct',
  [string]$IPv4 = '66.241.124.144',
  [string]$IPv6 = '2a09:8280:1::dd:3637:0',
  [int]$TTL = 300,
  [switch]$SkipAAAA,
  [string]$ApiToken = $env:CF_DNS_API_TOKEN
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ApiToken)) {
  throw 'Missing Cloudflare API token. Set CF_DNS_API_TOKEN with DNS Write permission.'
}

$headers = @{
  Authorization = "Bearer $ApiToken"
  'Content-Type' = 'application/json'
}

function Invoke-CfApi {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [object]$Body = $null
  )

  $params = @{
    Method  = $Method
    Uri     = $Uri
    Headers = $headers
  }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Compress -Depth 8)
  }

  $response = Invoke-RestMethod @params
  if (-not $response.success) {
    $errorJson = $response.errors | ConvertTo-Json -Compress
    throw "Cloudflare API error: $errorJson"
  }
  return $response.result
}

$fullName = "$HostName.$ZoneName"
Write-Host "Resolving zone: $ZoneName"
$zone = Invoke-CfApi -Method 'Get' -Uri "https://api.cloudflare.com/client/v4/zones?name=$ZoneName"
if (-not $zone -or $zone.Count -lt 1) {
  throw "Zone not found: $ZoneName"
}
$zoneId = $zone[0].id
Write-Host "Using zone id: $zoneId"

function Upsert-DnsRecord {
  param(
    [Parameter(Mandatory = $true)][string]$Type,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $listUri = "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?type=$Type&name=$Name&per_page=1"
  $existing = Invoke-CfApi -Method 'Get' -Uri $listUri

  $payload = @{
    type    = $Type
    name    = $Name
    content = $Content
    ttl     = $TTL
    proxied = $false
  }

  if ($existing -and $existing.Count -gt 0) {
    $recordId = $existing[0].id
    $updated = Invoke-CfApi -Method 'Put' -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records/$recordId" -Body $payload
    Write-Host "Updated $Type $Name -> $Content (proxied=$($updated.proxied), ttl=$($updated.ttl))"
    return
  }

  $created = Invoke-CfApi -Method 'Post' -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records" -Body $payload
  Write-Host "Created $Type $Name -> $Content (proxied=$($created.proxied), ttl=$($created.ttl))"
}

Upsert-DnsRecord -Type 'A' -Name $fullName -Content $IPv4
if (-not $SkipAAAA) {
  Upsert-DnsRecord -Type 'AAAA' -Name $fullName -Content $IPv6
}

Write-Host ''
Write-Host 'Current Cloudflare records:'
$records = Invoke-CfApi -Method 'Get' -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/dns_records?name=$fullName&per_page=20"
$records |
  Select-Object type, name, content, proxied, ttl |
  Sort-Object type |
  Format-Table -AutoSize

Write-Host ''
Write-Host 'Resolver checks (may take time to propagate):'
$resolvers = @('1.1.1.1', '8.8.8.8')
foreach ($resolver in $resolvers) {
  try {
    $a = Resolve-DnsName -Server $resolver -Name $fullName -Type A -ErrorAction Stop |
      Where-Object { $_.Type -eq 'A' } |
      Select-Object -ExpandProperty IPAddress
    Write-Host "$resolver A     : $($a -join ', ')"
  } catch {
    Write-Host "$resolver A     : (not resolved yet)"
  }

  if (-not $SkipAAAA) {
    try {
      $aaaa = Resolve-DnsName -Server $resolver -Name $fullName -Type AAAA -ErrorAction Stop |
        Where-Object { $_.Type -eq 'AAAA' } |
        Select-Object -ExpandProperty IPAddress
      Write-Host "$resolver AAAA  : $($aaaa -join ', ')"
    } catch {
      Write-Host "$resolver AAAA  : (not resolved yet)"
    }
  }
}

Write-Host ''
Write-Host "Done. DNS-only direct host configured for $fullName."
