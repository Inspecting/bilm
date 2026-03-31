param(
  [string]$HostName = 'direct.watchbilm.org',
  [string]$ExpectedIPv4 = '66.241.124.144',
  [string]$ExpectedIPv6 = '2a09:8280:1::dd:3637:0',
  [int]$TimeoutSec = 20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ResolvedIps {
  param(
    [Parameter(Mandatory = $true)][string]$Resolver,
    [Parameter(Mandatory = $true)][string]$Type
  )

  try {
    $records = Resolve-DnsName -Server $Resolver -Name $HostName -Type $Type -ErrorAction Stop
    if ($Type -eq 'A') {
      return $records | Where-Object { $_.Type -eq 'A' } | Select-Object -ExpandProperty IPAddress
    }
    return $records | Where-Object { $_.Type -eq 'AAAA' } | Select-Object -ExpandProperty IPAddress
  } catch {
    return @()
  }
}

Write-Host "Verifying DNS for $HostName"
$resolvers = @('1.1.1.1', '8.8.8.8')
foreach ($resolver in $resolvers) {
  $a = @(Get-ResolvedIps -Resolver $resolver -Type 'A')
  $aaaa = @(Get-ResolvedIps -Resolver $resolver -Type 'AAAA')
  Write-Host "$resolver A     : $(if($a.Count){$a -join ', '} else {'(none)'})"
  Write-Host "$resolver AAAA  : $(if($aaaa.Count){$aaaa -join ', '} else {'(none)'})"
}

if ($ExpectedIPv4) {
  $publicA = @(Get-ResolvedIps -Resolver '1.1.1.1' -Type 'A')
  if ($publicA -notcontains $ExpectedIPv4) {
    Write-Warning "Expected IPv4 $ExpectedIPv4 not visible yet on 1.1.1.1"
  }
}
if ($ExpectedIPv6) {
  $publicAAAA = @(Get-ResolvedIps -Resolver '1.1.1.1' -Type 'AAAA')
  if ($publicAAAA -notcontains $ExpectedIPv6) {
    Write-Warning "Expected IPv6 $ExpectedIPv6 not visible yet on 1.1.1.1"
  }
}

Write-Host ''
Write-Host "Checking TLS certificate for ${HostName}:443"
$tcp = [System.Net.Sockets.TcpClient]::new()
$tcp.Connect($HostName, 443)
$ssl = [System.Net.Security.SslStream]::new($tcp.GetStream(), $false, { $true })
$ssl.AuthenticateAsClient($HostName)
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($ssl.RemoteCertificate)
$sanExtension = $cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' } | Select-Object -First 1
$sanText = if ($sanExtension) { $sanExtension.Format($false) } else { '' }
Write-Host "Subject       : $($cert.Subject)"
Write-Host "Not Before    : $($cert.NotBefore)"
Write-Host "Not After     : $($cert.NotAfter)"
Write-Host "Issuer        : $($cert.Issuer)"
Write-Host "SAN           : $sanText"
if ($sanText -notmatch [regex]::Escape($HostName)) {
  Write-Warning "Certificate SAN does not currently include $HostName"
}
$ssl.Dispose()
$tcp.Dispose()

Write-Host ''
Write-Host 'Checking core HTTPS routes:'
$paths = @('/', '/movies/', '/tv/', '/settings/')
foreach ($path in $paths) {
  $url = "https://$HostName$path"
  try {
    $response = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec $TimeoutSec -MaximumRedirection 5
    Write-Host "$url -> HTTP $($response.StatusCode)"
  } catch {
    Write-Warning "$url -> request failed: $($_.Exception.Message)"
  }
}

Write-Host ''
Write-Host 'Verification complete.'
