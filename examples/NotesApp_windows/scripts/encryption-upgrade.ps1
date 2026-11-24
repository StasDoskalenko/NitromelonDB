# Upgrades a NotesApp install from the plain build to the encryption build, and back, on Windows.
# The counterpart of scripts/ci-notesapp-encryption-upgrade.sh (iOS, Android) and
# examples/NotesApp/maestro-encryption/: the same steps, deploying the two Release builds over
# each other (they share one AppX identity) and checking the database file in LocalState between
# steps. Drives the app with UI Automation, which, unlike the WinAppDriver e2e, can start and stop
# the app between steps without losing the session.
#
#   cd examples/NotesApp_windows
#   pwsh scripts/encryption-upgrade.ps1            # builds both variants (several times)
#
# Run from examples/NotesApp_windows. It wipes the app's LocalState first. Exits non-zero on the
# first failed check; screenshots of the failure go to .tmp/diagnostics.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing

$AppName = 'NitromelonWindows'
$DbName = 'nitromelon-windows'
$Marker = 'Upgrade marker'
$AfterEncrypt = 'After encryption'
$AfterDecrypt = 'After decrypt'
$Diagnostics = Join-Path (Get-Location) '.tmp/diagnostics'
$AE = [Windows.Automation.AutomationElement]

Add-Type @"
using System; using System.Runtime.InteropServices;
public class NitroNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
[NitroNative]::SetProcessDPIAware() | Out-Null

# ---------------------------------------------------------------- checks

function Step($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }

function Save-Screenshot($name) {
  try {
    New-Item -ItemType Directory -Force $Diagnostics | Out-Null
    $r = (Get-Win).Current.BoundingRectangle
    $bmp = New-Object Drawing.Bitmap([int]$r.Width, [int]$r.Height)
    [Drawing.Graphics]::FromImage($bmp).CopyFromScreen([int]$r.X, [int]$r.Y, 0, 0, $bmp.Size)
    $bmp.Save((Join-Path $Diagnostics "$name.png"))
  } catch {
    Write-Host "(no screenshot: $_)"
  }
}

function Assert($condition, $message) {
  if (-not $condition) {
    Save-Screenshot ('failed-' + ($message -replace '[^a-z0-9]+', '-').Substring(0, [Math]::Min(60, $message.Length)))
    Write-Host "FAILED: $message" -ForegroundColor Red
    Show-Files
    exit 1
  }
  Write-Host "ok: $message"
}

# ---------------------------------------------------------------- app process and files

function Package { Get-AppxPackage -Name $AppName }
function LocalState { Join-Path $env:LOCALAPPDATA "Packages/$((Package).PackageFamilyName)/LocalState" }

function Stop-App {
  Get-Process $AppName -ErrorAction SilentlyContinue | Stop-Process -Force
  # Wait for the process to release the database files
  for ($i = 0; $i -lt 20 -and (Get-Process $AppName -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
  Start-Sleep -Seconds 1
}

function Get-Win {
  $p = Get-Process $AppName -ErrorAction Stop | Select-Object -First 1
  $AE::RootElement.FindFirst('Children', (New-Object Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $p.Id)))
}

function Find-Id($id, $timeoutSec = 30) {
  $end = (Get-Date).AddSeconds($timeoutSec)
  do {
    try {
      $w = Get-Win
      if ($w) {
        $e = $w.FindFirst('Descendants', (New-Object Windows.Automation.PropertyCondition($AE::AutomationIdProperty, $id)))
        if ($e) { return $e }
      }
    } catch { }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $end)
  return $null
}

# The app is up once it shows either the header (database ready) or the setup-error screen
function Start-App {
  Start-Process "shell:AppsFolder\$((Package).PackageFamilyName)!App"
  $end = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $end) {
    if ((Find-Id 'app-title' 1) -or (Find-Id 'setup-error' 1)) { return }
  }
  Save-Screenshot 'app-did-not-start'
  throw 'The app did not show its header or a setup error within 90 seconds'
}

function Click-Id($id) {
  $e = Find-Id $id
  if (-not $e) { throw "not found: $id" }
  [NitroNative]::SetForegroundWindow((Get-Process $AppName | Select-Object -First 1).MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 300
  $r = $e.Current.BoundingRectangle
  [NitroNative]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) | Out-Null
  Start-Sleep -Milliseconds 200
  [NitroNative]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [NitroNative]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 500
}

function Set-Text($id, $text) {
  $e = Find-Id $id
  if (-not $e) { throw "not found: $id" }
  $e.SetFocus()
  Start-Sleep -Milliseconds 300
  $e.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($text)
}

function Get-Texts {
  (Get-Win).FindAll('Descendants', (New-Object Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [Windows.Automation.ControlType]::Text))) |
    ForEach-Object { $_.Current.Name } | Where-Object { $_ }
}

# Every note title on the current page (the hidden `notes-list` text, see NotesList.windows.tsx)
function Get-Notes { (Find-Id 'notes-list').Current.Name -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ } }

function Get-Status { Get-Texts | Where-Object { $_ -match '^(Encrypted|Not encrypted|Encrypting|Decrypting|Encryption failed|Decryption failed)' } | Select-Object -First 1 }

function Wait-Status($pattern, $timeoutSec = 120) {
  $end = (Get-Date).AddSeconds($timeoutSec)
  do {
    $s = Get-Status
    if ($s -match $pattern) { return $s }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $end)
  return (Get-Status)
}

function Get-TotalNotes {
  $subtitle = Get-Texts | Where-Object { $_ -match '(\d+) notes?$' } | Select-Object -First 1
  if ($subtitle -match '(\d+) notes?$') { return [int]$Matches[1] }
  return -1
}

function Add-Note($title) {
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    Set-Text 'title-input' $title
    Click-Id 'add-note-button'
    Start-Sleep -Seconds 2
    if ((Get-Notes) -contains $title) { return }
  }
  throw "could not add the note '$title'"
}

function Show-Files {
  $ls = LocalState
  Get-ChildItem $ls -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $bytes = try { [IO.File]::ReadAllBytes($_.FullName) } catch { $null }
    if ($bytes) {
      "{0,-30} {1,8} plainHeader={2} sha={3}" -f $_.Name, $_.Length, (Test-PlainHeader $_.FullName), (Get-FileHash $_.FullName -Algorithm SHA256).Hash.Substring(0, 12)
    } else {
      "{0,-30} (in use)" -f $_.Name
    }
  }
}

function Test-PlainHeader($path) {
  $b = [IO.File]::ReadAllBytes($path)
  $b.Length -ge 15 -and [Text.Encoding]::ASCII.GetString($b, 0, 15) -eq 'SQLite format 3'
}

function Db { Join-Path (LocalState) $DbName }

# The text of every database file ("-wal", "-journal"), to look for a note title in
function Any-File-Contains($text) {
  $found = $false
  Get-ChildItem (LocalState) -Force | ForEach-Object {
    $content = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($_.FullName))
    if ($content.Contains($text)) { $found = $true }
  }
  $found
}

function Hashes {
  $result = @{}
  foreach ($suffix in '', '-wal') {
    $path = (Db) + $suffix
    $result[$suffix] = if (Test-Path $path) { (Get-FileHash $path -Algorithm SHA256).Hash } else { 'missing' }
  }
  $result
}

function Wipe-LocalState {
  Get-ChildItem (LocalState) -Force -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
}

# ---------------------------------------------------------------- builds

function Build-App($encryption) {
  $label = if ($encryption) { 'encryption' } else { 'plain' }
  Stop-App
  if ($encryption) { $env:NITROMELONDB_ENCRYPTION = '1' } else { Remove-Item Env:NITROMELONDB_ENCRYPTION -ErrorAction SilentlyContinue }
  $tmp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
  $log = Join-Path $tmp "build-$label.log"
  yarn windows -- --arch x64 --release --logging --no-packager --no-launch *> $log
  Assert ($LASTEXITCODE -eq 0) "the $label build succeeded"
  $hasLine = [bool](Select-String -Path $log -Pattern 'SQLite encryption build' -SimpleMatch -List)
  Assert ($hasLine -eq $encryption) "the $label build log $(if ($encryption) { 'has' } else { 'has no' }) 'SQLite encryption build' line"
  $dll = Get-ChildItem (Package).InstallLocation -Recurse -Filter NitromelonDB.dll | Select-Object -First 1
  $hasCodec = [bool](Select-String -Path $dll.FullName -Pattern 'SQLite3 Multiple Ciphers' -SimpleMatch -List)
  Assert ($hasCodec -eq $encryption) "the deployed NitromelonDB.dll $(if ($encryption) { 'contains' } else { 'does not contain' }) sqlite3mc"
}

# ---------------------------------------------------------------- the upgrade path

Step '1. plain build: fresh install, add the marker note'
Build-App $false
Stop-App
Wipe-LocalState
Start-App
Add-Note $Marker
$total = Get-TotalNotes
Assert ($total -gt 0) "the plain build shows $total notes"
Stop-App
Assert (Test-PlainHeader (Db)) 'the database starts with the plain SQLite header'
Assert (Any-File-Contains $Marker) 'the marker is readable in the database files'
$plainHashes = Hashes

Step '2. encryption build over it: notes kept, "Not encrypted"'
Build-App $true
Assert (((Hashes)[''] -eq $plainHashes['']) -and ((Hashes)['-wal'] -eq $plainHashes['-wal'])) 'redeploying kept LocalState byte for byte'
Start-App
Assert ((Wait-Status 'Not encrypted' 30) -eq 'Not encrypted') 'the status is "Not encrypted"'
Assert ((Get-Notes) -contains $Marker) 'the marker note is there'
Assert ((Get-TotalNotes) -eq $total) "the note count is still $total"

Step '3. encrypt'
Click-Id 'encrypt-button'
Assert ((Wait-Status '^(Encrypted|Encryption failed)') -eq 'Encrypted') 'the status becomes "Encrypted"'
Add-Note $AfterEncrypt
$total++
Stop-App
Assert (-not (Test-PlainHeader (Db))) 'the database has no SQLite header'
Assert (-not (Any-File-Contains $Marker)) 'the marker is in no database file'
Assert (-not (Any-File-Contains $AfterEncrypt)) "'$AfterEncrypt' is in no database file"

Step '4. restart: opens with the passphrase'
Start-App
Assert ((Wait-Status '^Encrypted$' 30) -eq 'Encrypted') 'the status is "Encrypted"'
Assert (((Get-Notes) -contains $AfterEncrypt) -and ((Get-Notes) -contains $Marker)) 'both notes are there'
Assert ((Get-TotalNotes) -eq $total) "the note count is $total"
Stop-App
$encryptedHashes = Hashes

Step '5. plain build over it: refuses, never resets'
Build-App $false
Start-App
$error5 = Find-Id 'setup-error' 30
Assert ($null -ne $error5) 'the setup error screen shows'
Assert ($error5.Current.Name -match 'encryption_key_required') 'the error is encryption_key_required'
Stop-App
Assert (((Hashes)[''] -eq $encryptedHashes['']) -and ((Hashes)['-wal'] -eq $encryptedHashes['-wal'])) 'the database and -wal are byte for byte unchanged'

Step '6. encryption build again: every note still there'
Build-App $true
Start-App
Assert ((Wait-Status '^Encrypted$' 30) -eq 'Encrypted') 'the status is "Encrypted"'
Assert (((Get-Notes) -contains $AfterEncrypt) -and ((Get-Notes) -contains $Marker)) 'both notes are there'
Assert ((Get-TotalNotes) -eq $total) "the note count is $total"

Step '7. decrypt'
Click-Id 'decrypt-button'
Assert ((Wait-Status '^(Not encrypted|Decryption failed)') -eq 'Not encrypted') 'the status becomes "Not encrypted"'
Add-Note $AfterDecrypt
$total++
Assert ((Get-TotalNotes) -eq $total) "the note count is $total"
Stop-App
Assert (Test-PlainHeader (Db)) 'the database starts with the plain SQLite header again'
Assert (Any-File-Contains $Marker) 'the marker is readable again'
Assert (-not (Get-ChildItem (LocalState) -Force | Where-Object Name -like '*decrypted*')) 'no -nitromelon-decrypted copy is left'

Step '8. plain build over the decrypted database'
Build-App $false
Start-App
Assert (-not (Find-Id 'setup-error' 2)) 'no setup error'
$notes = Get-Notes
Assert (($notes -contains $AfterDecrypt) -and ($notes -contains $AfterEncrypt) -and ($notes -contains $Marker)) 'every note is there'
Assert ((Get-TotalNotes) -eq $total) "the note count is $total"
Stop-App

Write-Host "`nThe upgrade path passed." -ForegroundColor Green
