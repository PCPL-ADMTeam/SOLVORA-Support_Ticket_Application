# =====================================================================
#  app-health-logger.ps1
#  Logs system + application health to daily CSV files.
#  Run every 1-5 minutes from Task Scheduler as SYSTEM.
#
#  Output (one file per day, opens in Excel):
#    system-YYYY-MM-DD.csv   CPU %, RAM %, app URL check, DB check
#    apps-YYYY-MM-DD.csv     per PM2 app: status, CPU %, RAM MB, restarts, uptime
#    disk-YYYY-MM-DD.csv     per drive: size, free GB, free %
#    top-YYYY-MM-DD.csv      top 5 processes, only written when CPU/RAM is high
# =====================================================================

# ---------- Settings (edit these) ----------
$env:PM2_HOME = "C:\Users\solvoraadmin\.pm2"
$pm2          = "C:\Users\solvoraadmin\AppData\Roaming\npm\pm2.cmd"      # check with: where.exe pm2
$logDir       = "C:\Scripts\logs\health"
$keepDays     = 30                                # delete logs older than this
$healthUrl    = "http://localhost:5000/health"    # "" to skip
$dbHost       = "solvora.postgres.database.azure.com"   # "" to skip
$dbPort       = 5432
$warnCpu      = 85      # %
$warnRam      = 85      # %
$warnDiskFree = 15      # %
# -------------------------------------------

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $logDir | Out-Null
$ts  = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$day = Get-Date -Format 'yyyy-MM-dd'
function Write-Csv($name, $rows) {
    if ($rows) { $rows | Export-Csv "$logDir\$name-$day.csv" -Append -NoTypeInformation -Encoding UTF8 }
}

# ---------- System CPU and RAM ----------
$cpu = [math]::Round(((Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 2 -MaxSamples 3).CounterSamples.CookedValue |
        Measure-Object -Average).Average, 1)

$os       = Get-CimInstance Win32_OperatingSystem
$ramTotal = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)                         # GB
$ramFree  = [math]::Round($os.FreePhysicalMemory / 1MB, 2)                             # GB
$ramPct   = [math]::Round((1 - $os.FreePhysicalMemory / $os.TotalVisibleMemorySize) * 100, 1)

# ---------- App URL check ----------
$httpStatus = ""; $httpMs = ""
if ($healthUrl) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest $healthUrl -UseBasicParsing -TimeoutSec 10
        $httpStatus = $r.StatusCode
    } catch {
        $httpStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "DOWN" }
    }
    $httpMs = $sw.ElapsedMilliseconds
}

# ---------- PostgreSQL reachability (TCP) ----------
$dbStatus = ""; $dbMs = ""
if ($dbHost) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $tcp = New-Object Net.Sockets.TcpClient
    try {
        $ok = $tcp.ConnectAsync($dbHost, $dbPort).Wait(5000)
        $dbStatus = if ($ok -and $tcp.Connected) { "OK" } else { "TIMEOUT" }
    } catch { $dbStatus = "FAIL" }
    finally { $tcp.Close() }
    $dbMs = $sw.ElapsedMilliseconds
}

# ---------- Disks ----------
$diskRows = @(); $diskWarn = $false
foreach ($d in Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3") {
    $freePct = [math]::Round($d.FreeSpace / $d.Size * 100, 1)
    if ($freePct -lt $warnDiskFree) { $diskWarn = $true }
    $diskRows += [pscustomobject]@{
        Time     = $ts
        Drive    = $d.DeviceID
        SizeGB   = [math]::Round($d.Size / 1GB, 1)
        FreeGB   = [math]::Round($d.FreeSpace / 1GB, 1)
        FreePct  = $freePct
        Status   = if ($freePct -lt $warnDiskFree) { "WARN" } else { "OK" }
    }
}
Write-Csv "disk" $diskRows

# ---------- Per-application stats (PM2) ----------
$appRows = @()
try {
    $raw  = (& $pm2 jlist 2>$null) -join "`n"
    $json = $raw.Substring($raw.IndexOf('['))            # skip any PM2 warning text
    $apps = $json | ConvertFrom-Json
    foreach ($a in $apps) {
        $up = ""
        if ($a.pm2_env.status -eq 'online' -and $a.pm2_env.pm_uptime) {
            $start = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$a.pm2_env.pm_uptime).LocalDateTime
            $up = [math]::Round(((Get-Date) - $start).TotalMinutes, 0)
        }
        $appRows += [pscustomobject]@{
            Time       = $ts
            App        = $a.name
            PID        = $a.pid
            Status     = $a.pm2_env.status
            CpuPct     = $a.monit.cpu
            RamMB      = [math]::Round($a.monit.memory / 1MB, 1)
            Restarts   = $a.pm2_env.restart_time
            UptimeMin  = $up
        }
    }
} catch {
    # Fallback if PM2 can't be read: log all node.exe processes directly
    $cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
    foreach ($p in Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object Name -like 'node*') {
        $appRows += [pscustomobject]@{
            Time      = $ts
            App       = "node (PM2 unreadable)"
            PID       = $p.IDProcess
            Status    = "running"
            CpuPct    = [math]::Round($p.PercentProcessorTime / $cores, 1)
            RamMB     = [math]::Round($p.WorkingSetPrivate / 1MB, 1)
            Restarts  = ""
            UptimeMin = [math]::Round($p.ElapsedTime / 60, 0)
        }
    }
}
Write-Csv "apps" $appRows

# ---------- System summary row ----------
$issues = @()
if ($cpu    -gt $warnCpu) { $issues += "CPU" }
if ($ramPct -gt $warnRam) { $issues += "RAM" }
if ($diskWarn)            { $issues += "DISK" }
if ($healthUrl -and "$httpStatus" -ne "200") { $issues += "APP" }
if ($dbHost -and $dbStatus -ne "OK")         { $issues += "DB" }
if ($appRows | Where-Object { $_.Status -notin 'online','running' }) { $issues += "APP-STOPPED" }

Write-Csv "system" ([pscustomobject]@{
    Time       = $ts
    CpuPct     = $cpu
    RamPct     = $ramPct
    RamUsedGB  = [math]::Round($ramTotal - $ramFree, 2)
    RamTotalGB = $ramTotal
    AppHttp    = $httpStatus
    AppMs      = $httpMs
    DbStatus   = $dbStatus
    DbMs       = $dbMs
    Status     = if ($issues) { "WARN: " + ($issues -join ",") } else { "OK" }
})

# ---------- Top processes when CPU or RAM is high ----------
if ($cpu -gt $warnCpu -or $ramPct -gt $warnRam) {
    $cores = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
    $top = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
        Where-Object { $_.Name -notin '_Total','Idle' } |
        Sort-Object WorkingSetPrivate -Descending | Select-Object -First 5 |
        ForEach-Object {
            [pscustomobject]@{
                Time    = $ts
                Process = $_.Name
                PID     = $_.IDProcess
                CpuPct  = [math]::Round($_.PercentProcessorTime / $cores, 1)
                RamMB   = [math]::Round($_.WorkingSetPrivate / 1MB, 1)
            }
        }
    Write-Csv "top" $top
}

# ---------- Clean up old logs ----------
Get-ChildItem $logDir -Filter *.csv |
    Where-Object LastWriteTime -lt (Get-Date).AddDays(-$keepDays) |
    Remove-Item -Force