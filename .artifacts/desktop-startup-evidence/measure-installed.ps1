param([int]$Runs = 3)
$exe = 'M:\deepseek\harness\DeepSeek Harness.exe'

for ($run = 1; $run -le $Runs; $run++) {
  Get-Process | Where-Object { $_.Path -like 'M:\deepseek\harness\*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process -FilePath $exe -PassThru
  $rendererAt = $null; $hostPid = $null; $hostAt = $null; $listenAt = $null; $windowAt = $null; $title = ''
  while ($sw.ElapsedMilliseconds -lt 30000) {
    $p.Refresh()
    if ($p.HasExited) { break }
    $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)" -ErrorAction SilentlyContinue
    foreach ($k in $kids) {
      if ($null -eq $rendererAt -and $k.CommandLine -like '*--type=renderer*') { $rendererAt = $sw.ElapsedMilliseconds }
      if ($null -eq $hostPid -and $k.CommandLine -like '*dsh-desktop-host*') { $hostPid = $k.ProcessId; $hostAt = $sw.ElapsedMilliseconds }
    }
    if ($hostPid -and $null -eq $listenAt) {
      if (Get-NetTCPConnection -OwningProcess $hostPid -State Listen -ErrorAction SilentlyContinue) { $listenAt = $sw.ElapsedMilliseconds }
    }
    if ($p.MainWindowHandle -ne 0 -and $null -eq $windowAt) {
      $windowAt = $sw.ElapsedMilliseconds
      $title = $p.MainWindowTitle
    }
    if ($windowAt) { break }
    Start-Sleep -Milliseconds 20
  }
  "run=$run renderer=$rendererAt hostSpawn=$hostAt hostListen=$listenAt firstWindow=$windowAt title=$title"
  taskkill.exe /PID $p.Id /T /F 2>$null | Out-Null
  Start-Sleep -Milliseconds 1200
}
