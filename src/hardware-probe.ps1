# Reads a summary of this PC's hardware for Ravenshelf's "PC specs" page and
# prints it as one JSON object. Read-only: it changes nothing and contacts no
# network. It asks Windows only for the model names, sizes and capability
# levels listed below, and prints nothing else. It never asks for serial
# numbers, the computer name, user names, volume labels or network addresses.
# A graphics adapter's device path is looked at only to pick out how the
# adapter is connected and its maker and model numbers; the rest of the path
# (which can identify one device) is never printed.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch { }
$result = @{ schema = 1 }

try {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -Property Caption,Version,BuildNumber,OSArchitecture
  $result.system = @{ caption = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber; architecture = [string]$os.OSArchitecture }
} catch { }

try {
  $result.processors = @(Get-CimInstance -ClassName Win32_Processor -Property Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed | ForEach-Object {
    @{ name = [string]$_.Name; cores = [string]$_.NumberOfCores; threads = [string]$_.NumberOfLogicalProcessors; megahertz = [string]$_.MaxClockSpeed }
  })
} catch { }

# The size of each memory module. Their sum is the installed memory.
try {
  $result.memory = @{
    modules = @(Get-CimInstance -ClassName Win32_PhysicalMemory -Property Capacity | ForEach-Object { [string]$_.Capacity })
  }
} catch { }

# Graphics adapters Windows has a driver for: their names, the setup file the
# driver came from (to recognise Windows' basic display driver in any language)
# and whether Windows reports the device as working.
try {
  $result.video = @(Get-CimInstance -ClassName Win32_VideoController -Property Name,AdapterCompatibility,PNPDeviceID,AdapterRAM,DriverVersion,InfFilename,InfSection,ConfigManagerErrorCode,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate | ForEach-Object {
    $path = [string]$_.PNPDeviceID; $bus = ''; $vendor = ''; $device = ''
    if ($path -match '^([A-Za-z]+)\\') { $bus = $Matches[1] }
    if ($path -match 'VEN_([0-9A-Fa-f]{4})&DEV_([0-9A-Fa-f]{4})') { $vendor = $Matches[1]; $device = $Matches[2] }
    @{
      name = [string]$_.Name; maker = [string]$_.AdapterCompatibility; bus = $bus; vendor = $vendor; device = $device
      memory = [string]$_.AdapterRAM; driver = [string]$_.DriverVersion
      inf = [string]$_.InfFilename; section = [string]$_.InfSection; status = [string]$_.ConfigManagerErrorCode
      width = [string]$_.CurrentHorizontalResolution; height = [string]$_.CurrentVerticalResolution; refresh = [string]$_.CurrentRefreshRate
    }
  })
} catch { }

# What DirectX recorded for each graphics adapter: its real dedicated memory
# (Win32_VideoController stops at 4 GB) and the Direct3D levels it supports.
try {
  $result.directx = @(Get-ChildItem -LiteralPath 'HKLM:\SOFTWARE\Microsoft\DirectX' | ForEach-Object {
    $record = Get-ItemProperty -LiteralPath $_.PSPath
    if ($null -ne $record.Description) {
      @{
        name = [string]$record.Description; vendor = [string]$record.VendorId; device = [string]$record.DeviceId
        dedicated = [string]$record.DedicatedVideoMemory; dedicatedSystem = [string]$record.DedicatedSystemMemory; shared = [string]$record.SharedSystemMemory
        d3d11 = [string]$record.MaxD3D11FeatureLevel; d3d12 = [string]$record.MaxD3D12FeatureLevel
        type = [string]$record.AdapterType; seen = [string]$record.LastSeen
      }
    }
  })
} catch { }

# The memory size each display driver reports about itself, for PCs where the
# DirectX records above are missing.
try {
  $result.drivers = @(Get-ChildItem -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' | Where-Object { $_.PSChildName -match '^\d{4}$' } | ForEach-Object {
    $record = Get-ItemProperty -LiteralPath $_.PSPath
    @{ name = [string]$record.DriverDesc; memory = [string]$record.'HardwareInformation.qwMemorySize' }
  })
} catch { }

try {
  $result.disks = @(Get-CimInstance -Namespace 'root/Microsoft/Windows/Storage' -ClassName MSFT_PhysicalDisk -Property DeviceId,FriendlyName,MediaType,BusType,SpindleSpeed | ForEach-Object {
    @{ id = [string]$_.DeviceId; model = [string]$_.FriendlyName; media = [string]$_.MediaType; bus = [string]$_.BusType; spindle = [string]$_.SpindleSpeed }
  })
} catch { }

# How each numbered disk is connected, to recognise Storage Spaces.
try {
  $result.connections = @(Get-CimInstance -Namespace 'root/Microsoft/Windows/Storage' -ClassName MSFT_Disk -Property Number,BusType | ForEach-Object {
    @{ disk = [string]$_.Number; bus = [string]$_.BusType }
  })
} catch { }

try {
  $result.partitions = @(Get-CimInstance -Namespace 'root/Microsoft/Windows/Storage' -ClassName MSFT_Partition -Property DriveLetter,DiskNumber | Where-Object { $_.DriveLetter } | ForEach-Object {
    @{ letter = [string]$_.DriveLetter; disk = [string]$_.DiskNumber }
  })
} catch { }

# Fixed and removable drives only, so network drives are never contacted.
try {
  $result.volumes = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=2 OR DriveType=3' -Property DeviceID,DriveType,FileSystem,Size,FreeSpace | ForEach-Object {
    @{ letter = [string]$_.DeviceID; type = [string]$_.DriveType; format = [string]$_.FileSystem; size = [string]$_.Size; free = [string]$_.FreeSpace }
  })
} catch { }

$result | ConvertTo-Json -Depth 4 -Compress
