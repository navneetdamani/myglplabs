param([Parameter(Mandatory=$true)][string]$InstallDirectory,[Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference='Stop'
$taskDirectory=[IO.Path]::GetFullPath($InstallDirectory)
$taskConfig=Join-Path $taskDirectory 'worker-config.json'
$taskWorker=Join-Path $taskDirectory 'local-worker.mjs'
if(!(Test-Path -LiteralPath $taskConfig) -or !(Test-Path -LiteralPath $taskWorker)){throw 'Initialize the protected worker first'}
$taskRunner=Join-Path $taskDirectory 'Run-Worker.ps1'
@'
param([Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference='Stop'
$taskWorker=Join-Path $PSScriptRoot 'local-worker.mjs'
$taskConfig=Join-Path $PSScriptRoot 'worker-config.json'
$taskArguments=@(('"'+$taskWorker+'"'),('"'+$taskConfig+'"'))
$taskProcess=Start-Process -FilePath $NodePath -ArgumentList $taskArguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'worker.log') -RedirectStandardError (Join-Path $PSScriptRoot 'worker-error.log') -PassThru -Wait
if($taskProcess.ExitCode -ne 0){throw 'MyGLPLabs worker stopped; inspect its private local log'}
'@ | Set-Content -LiteralPath $taskRunner -Encoding utf8
$taskName='MyGLPLabs Update Worker'
$taskDescription='MyGLPLabs subscription worker; owner interactive account only; no paid API fallback.'
$taskExisting=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($taskExisting -and $taskExisting.Description -ne $taskDescription){throw 'An unrelated task already uses this name'}
$taskIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "'+$taskRunner+'" -NodePath "'+$NodePath+'"') -WorkingDirectory $taskDirectory
$taskTrigger=New-ScheduledTaskTrigger -AtLogOn -User $taskIdentity
$taskPrincipal=New-ScheduledTaskPrincipal -UserId $taskIdentity -LogonType Interactive -RunLevel Limited
$taskSettings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Description $taskDescription -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State | ConvertTo-Json -Compress
