$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.action -eq 'discover') {
  $steam = @()
  foreach ($key in @('HKCU:\Software\Valve\Steam','HKLM:\Software\Valve\Steam','HKLM:\Software\WOW6432Node\Valve\Steam')) {
    $item = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
    if ($item.SteamPath) { $steam += [string]$item.SteamPath }
    if ($item.InstallPath) { $steam += [string]$item.InstallPath }
  }
  $uninstall = @()
  foreach ($root in @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
    foreach ($key in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
      $item = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
      if (-not $item.DisplayName) { continue }
      $isCandidate = $key.PSChildName -match '^Steam App \d+$' -or $item.InstallLocation -match '[\\/](Games|GOG Games|DODI-Repacks|FitGirl|steamapps)[\\/]' -or $item.Publisher -match 'FitGirl|DODI|GOG\.com|Rockstar Games|Ubisoft|Electronic Arts|Bethesda|Larian|CD PROJEKT|NCSoft'
      if (-not $isCandidate) { continue }
      $uninstall += [PSCustomObject]@{title=[string]$item.DisplayName;version=[string]$item.DisplayVersion;publisher=[string]$item.Publisher;installPath=[string]$item.InstallLocation;icon=[string]$item.DisplayIcon;key=[string]$key.Name;keyName=[string]$key.PSChildName}
    }
  }
  $gog = @()
  foreach ($root in @('HKLM:\Software\GOG.com\Games','HKLM:\Software\WOW6432Node\GOG.com\Games','HKCU:\Software\GOG.com\Games')) {
    foreach ($key in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
      $item = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
      if ($item.gameName -and $item.path) { $gog += [PSCustomObject]@{title=[string]$item.gameName;installPath=[string]$item.path;version=[string]$item.version;buildId=[string]$item.buildId;id=[string]$key.PSChildName;key=[string]$key.Name} }
    }
  }
  [PSCustomObject]@{steamRoots=@($steam | Select-Object -Unique);uninstall=@($uninstall | Select-Object -First 2000);gog=@($gog | Select-Object -First 1000)} | ConvertTo-Json -Depth 6 -Compress
} elseif ($request.action -eq 'versions') {
  foreach ($file in @($request.paths | Select-Object -First 500)) {
    try {
      $item = Get-Item -LiteralPath ([string]$file) -ErrorAction Stop
      if ($item.PSIsContainer -or $item.Extension -ne '.exe' -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
      $info = $item.VersionInfo
      [PSCustomObject]@{path=$item.FullName;fileVersion=[string]$info.FileVersion;productVersion=[string]$info.ProductVersion;productName=[string]$info.ProductName;description=[string]$info.FileDescription} | ConvertTo-Json -Depth 4 -Compress
    } catch { }
  }
} else { throw 'Unsupported local inventory action.' }
