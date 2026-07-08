# Build + sign the AE MCP Watcher ZXP.
# Downloads ZXPSignCmd on first run; generates a self-signed cert on first run
# (cert/ is gitignored — the password lives in cert/password.txt, local only).

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

$version = ([xml](Get-Content "$root\src\CSXS\manifest.xml")).ExtensionManifest.ExtensionBundleVersion
$zxp = "$root\dist\ae-mcp-watcher-$version.zxp"

# 1. ZXPSignCmd
$signCmd = "$root\tools\ZXPSignCmd.exe"
if (-not (Test-Path $signCmd)) {
    New-Item -ItemType Directory -Force "$root\tools" | Out-Null
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing "https://github.com/Adobe-CEP/CEP-Resources/raw/master/ZXPSignCMD/4.1.103/win64/ZXPSignCmd.exe" -OutFile $signCmd
    # behind a TLS-intercepting proxy, use instead:
    #   gh api -H "Accept: application/vnd.github.raw" repos/Adobe-CEP/CEP-Resources/contents/ZXPSignCMD/4.1.103/win64/ZXPSignCmd.exe > tools/ZXPSignCmd.exe
}

# 2. Self-signed cert
$cert = "$root\cert\selfsign.p12"
$passFile = "$root\cert\password.txt"
if (-not (Test-Path $cert)) {
    New-Item -ItemType Directory -Force "$root\cert" | Out-Null
    $pass = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    Set-Content -Path $passFile -Value $pass -Encoding ascii -NoNewline
    & $signCmd -selfSignedCert IL "Tel Aviv" "Mickey Perry" "Mickey Perry" $pass $cert
}
$password = (Get-Content $passFile -Raw).Trim()

# 3. Regenerate revive.jsx from watcher.jsx so they can never drift
$watcher = Get-Content "$root\src\host\watcher.jsx" -Raw
$revive = $watcher + "`n// Auto-generated revive entry: injected into a running AE via ``AfterFX.exe -r revive.jsx```n" +
    "// to restart the watcher without reopening the panel. Do not edit - regenerate from watcher.jsx.`n" +
    "// Uses start (not ensure): revive only fires when a command was actually issued,`n" +
    "// so it deliberately overrides a manual Stop.`n" +
    "AE_MCP_start();`n"
Set-Content -Path "$root\bridge\revive.jsx" -Value $revive -Encoding utf8 -NoNewline

# 4. Sign
New-Item -ItemType Directory -Force "$root\dist" | Out-Null
if (Test-Path $zxp) { Remove-Item $zxp -Force }
& $signCmd -sign "$root\src" $zxp $cert $password -tsa "http://timestamp.digicert.com"
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Timestamp server failed, signing without timestamp..."
    & $signCmd -sign "$root\src" $zxp $cert $password
}
if ($LASTEXITCODE -ne 0) { throw "ZXPSignCmd failed" }

& $signCmd -verify $zxp
Write-Host "`nBuilt $zxp"
