param(
 [Parameter(Mandatory=$true)][string]$InstallDirectory,
 [Parameter(Mandatory=$true)][string]$PortalOrigin,
 [Parameter(Mandatory=$true)][string]$CodexPath,
 [Parameter(Mandatory=$true)][string]$SourceDirectory
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$taskDirectory=[IO.Path]::GetFullPath($InstallDirectory)
New-Item -ItemType Directory -Path $taskDirectory -Force | Out-Null
$taskIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAcl=Get-Acl -LiteralPath $taskDirectory
$taskAcl.SetAccessRuleProtection($true,$false)
foreach($taskName in @($taskIdentity,'SYSTEM')){
 $taskRule=[Security.AccessControl.FileSystemAccessRule]::new($taskName,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
 $taskAcl.AddAccessRule($taskRule)
}
Set-Acl -LiteralPath $taskDirectory -AclObject $taskAcl
$taskCredential=Join-Path $taskDirectory 'worker-credential.dpapi'
if(Test-Path -LiteralPath $taskCredential){
 $taskPlain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($taskCredential),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
}else{
 $taskRandom=New-Object byte[] 32
 [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($taskRandom)
 $taskToken=[Convert]::ToBase64String($taskRandom).TrimEnd('=').Replace('+','-').Replace('/','_')
 $taskPlain=[Text.Encoding]::UTF8.GetBytes($taskToken)
 [IO.File]::WriteAllBytes($taskCredential,[Security.Cryptography.ProtectedData]::Protect($taskPlain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 $taskToken=$null
 [Array]::Clear($taskRandom,0,$taskRandom.Length)
}
try{
 $taskHash=([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($taskPlain))).Replace('-','').ToLowerInvariant()
}finally{[Array]::Clear($taskPlain,0,$taskPlain.Length)}
foreach($taskFile in @('local-worker.mjs','local-generator.mjs','policy.mjs','unlock-worker.ps1')){
 Copy-Item -LiteralPath (Join-Path $SourceDirectory $taskFile) -Destination (Join-Path $taskDirectory $taskFile) -Force
}
$taskConfig=Join-Path $taskDirectory 'worker-config.json'
@{origin=$PortalOrigin;credentialPath=$taskCredential;codex=$CodexPath;model='gpt-6-luna'} | ConvertTo-Json | Set-Content -LiteralPath $taskConfig -Encoding utf8
@{workerTokenHash=$taskHash;configPath=$taskConfig;directory=$taskDirectory} | ConvertTo-Json -Compress
