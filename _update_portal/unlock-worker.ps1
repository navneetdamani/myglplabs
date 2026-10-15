param([Parameter(Mandatory=$true)][string]$CredentialPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$taskEncrypted=[IO.File]::ReadAllBytes($CredentialPath)
$taskPlain=[Security.Cryptography.ProtectedData]::Unprotect($taskEncrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try { [Console]::Write([Text.Encoding]::UTF8.GetString($taskPlain)) }
finally { [Array]::Clear($taskPlain,0,$taskPlain.Length) }
