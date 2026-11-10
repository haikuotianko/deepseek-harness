param(
  [switch]$KeepOpen,
  [string]$Root = 'N:\test\deepseek-harness-master'
)

$log = Join-Path $env:TEMP 'dsh-dev-measure.log'
Remove-Item $log, "$log.err" -Force -ErrorAction SilentlyContinue
$sw = [Diagnostics.Stopwatch]::StartNew()
$launcher = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'pnpm run start:desktop' `
  -WorkingDirectory $Root -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru

$electron = $null
$electronSeen = $null
$windowAt = $null
$hostPid = $null
$hostAt = $null
$listenAt = $null
$title = ''

while ($sw.ElapsedMilliseconds -lt 180000) {
  if (-not $electron) {
    $e = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -like "*$Root*" -and $_.CommandLine -notlike '*--type=*' } |
      Select-Object -First 1
    if ($e) {
      $electron = $e
      $electronSeen = $sw.ElapsedMilliseconds
    }
  }
  if ($electron) {
    $p = Get-Process -Id $electron.ProcessId -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne 0 -and -not $windowAt) {
      $windowAt = $sw.ElapsedMilliseconds
      $title = $p.MainWindowTitle
    }
    if (-not $hostPid) {
      $kid = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($electron.ProcessId)" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*dsh-desktop-host*' } |
        Select-Object -First 1
      if ($kid) {
        $hostPid = $kid.ProcessId
        $hostAt = $sw.ElapsedMilliseconds
      }
    }
    if ($hostPid -and -not $listenAt) {
      if (Get-NetTCPConnection -OwningProcess $hostPid -State Listen -ErrorAction SilentlyContinue) {
        $listenAt = $sw.ElapsedMilliseconds
      }
    }
    if ($windowAt) { break }
  }
  Start-Sleep -Milliseconds 20
}

"launcher started: 0 ms"
"electron first seen: $electronSeen ms"
if ($electronSeen -ne $null -and $windowAt -ne $null) {
  "first window: $windowAt ms  (+$($windowAt - $electronSeen) ms after Electron)"
} else {
  "first window: not detected"
}
"host spawn: $hostAt ms; host listen: $listenAt ms"
"window title: $title"
"log: $log"

if (-not $KeepOpen) {
  Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*scripts/dev.ts*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Stop-Process -Id $launcher.Id -Force -ErrorAction SilentlyContinue
}
