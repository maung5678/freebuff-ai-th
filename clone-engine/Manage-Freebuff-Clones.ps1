Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$rebuildAll = $args -contains '--rebuild-all'

$cloneRoot = Join-Path $env:LOCALAPPDATA 'Freebuff-Clones'
$configFile = Join-Path $cloneRoot 'clones.json'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$availableLetters = @([char]'A'..[char]'Z' | ForEach-Object { [string][char]$_ })

function Get-CloneConfig {
    if (Test-Path $configFile) {
        return Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    }
    return @{ clones = @() }
}

function Save-CloneConfig {
    param($config)
    if (-not (Test-Path $cloneRoot)) { New-Item -ItemType Directory -Path $cloneRoot -Force | Out-Null }
    $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configFile -Encoding UTF8
}

function Refresh-List {
    param($listBox)
    $listBox.Items.Clear()
    $config = Get-CloneConfig
    foreach ($c in $config.clones) {
        $letter = Get-CloneLetter $c
        $listBox.Items.Add("[$letter] $($c.Name)")
    }
}

function Get-CloneLetter {
    param($clone)
    if ($clone.IconLetter -match '^[A-Z]$') { return $clone.IconLetter }
    if ($clone.Name -match '(?i)191') { return 'Z' }
    if ($clone.Id -match 'freebuff-clone-([a-z])$') { return $Matches[1].ToUpperInvariant() }
    return $null
}

function Get-NextCloneLetter {
    param($config)
    $used = @($config.clones | ForEach-Object { Get-CloneLetter $_ } | Where-Object { $_ })
    return $availableLetters | Where-Object { $used -notcontains $_ } | Select-Object -First 1
}

function New-LetterIcon {
    param([string]$Letter, [string]$PngPath, [string]$IcoPath)
    $bitmap = New-Object System.Drawing.Bitmap 256, 256
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $graphics.Clear([System.Drawing.Color]::FromArgb(28, 32, 40))
        $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(76, 175, 255))
        $font = New-Object System.Drawing.Font('Segoe UI', 154, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        try {
            $format = New-Object System.Drawing.StringFormat
            $format.Alignment = [System.Drawing.StringAlignment]::Center
            $format.LineAlignment = [System.Drawing.StringAlignment]::Center
            $graphics.DrawString($Letter, $font, $brush, (New-Object System.Drawing.RectangleF(0, 0, 256, 246)), $format)
            $bitmap.Save($PngPath, [System.Drawing.Imaging.ImageFormat]::Png)
            $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
            try {
                $stream = [System.IO.File]::Create($IcoPath)
                try { $icon.Save($stream) } finally { $stream.Dispose() }
            } finally { $icon.Dispose() }
        } finally {
            $font.Dispose()
            $brush.Dispose()
        }
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Build-SingleClone {
    param($clone)
    $src = "$env:LOCALAPPDATA\Programs\@codebufffreebuff-desktop"
    $bun = "$src\resources\bun\bun.exe"
    $chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"

    $cloneDir = Join-Path $cloneRoot $clone.Name
    $profileDir = Join-Path $cloneRoot $clone.Profile
    $asarPath = Join-Path $cloneDir 'resources\app.asar'
    $appDir = Join-Path $cloneDir 'resources\app'
    $letter = Get-CloneLetter $clone
    if (-not $letter) { throw "Clone '$($clone.Name)' has no valid icon letter." }

    # Sync the current application on every build so clones receive upstream updates.
    # Profiles are stored outside cloneDir and are therefore preserved.
    if (-not (Test-Path $cloneDir)) { New-Item -ItemType Directory -Path $cloneDir -Force | Out-Null }
    Copy-Item -Path "$src\*" -Destination $cloneDir -Recurse -Force

    # Install the update-friendly Thai UI layer into the copied web interface.
    $thaiSource = Join-Path $scriptDir 'freebuff-th.js'
    $uiDir = Join-Path $cloneDir 'resources\orchestrator\ui'
    $uiIndex = Join-Path $uiDir 'index.html'
    if ((Test-Path $thaiSource) -and (Test-Path $uiIndex)) {
        Copy-Item -LiteralPath $thaiSource -Destination (Join-Path $uiDir 'freebuff-th.js') -Force
        $extendedUi = Join-Path $cloneRoot 'Freebuff A\resources\orchestrator\ui'
        $extendedRuntime = Join-Path $extendedUi 'fbth-th.js'
        $extendedDictionary = Join-Path $extendedUi 'fbth-dict.json'
        $runtimeTarget = Join-Path $uiDir 'fbth-th.js'
        $dictionaryTarget = Join-Path $uiDir 'fbth-dict.json'
        if ((Test-Path -LiteralPath $extendedRuntime) -and
            ([IO.Path]::GetFullPath($extendedRuntime) -ne [IO.Path]::GetFullPath($runtimeTarget))) {
            Copy-Item -LiteralPath $extendedRuntime -Destination $runtimeTarget -Force
        }
        if ((Test-Path -LiteralPath $extendedDictionary) -and
            ([IO.Path]::GetFullPath($extendedDictionary) -ne [IO.Path]::GetFullPath($dictionaryTarget))) {
            Copy-Item -LiteralPath $extendedDictionary -Destination $dictionaryTarget -Force
        }
        $uiHtml = Get-Content -LiteralPath $uiIndex -Raw -Encoding UTF8
        if ((Test-Path -LiteralPath $runtimeTarget) -and $uiHtml -notmatch 'fbth-th\.js') {
            $uiHtml = $uiHtml -replace '(</head>)', "    <script src=`"./fbth-th.js`"></script>`r`n  `$1"
        }
        if ($uiHtml -notmatch 'freebuff-th\.js') {
            $uiHtml = $uiHtml -replace '(</head>)', "    <script src=`"./freebuff-th.js`"></script>`r`n  `$1"
        }
        $brandScript = Join-Path $uiDir 'freebuff-clone-brand.js'
        $brandNameJson = $clone.Name | ConvertTo-Json -Compress
        $brandJs = @"
(() => {
  const cloneName = $brandNameJson;
  const brandTitle = () => {
    const current = document.title || '';
    let next = current;
    if (!current || current === 'Freebuff' || current === 'Freebuff Desktop') next = cloneName;
    else if (current.endsWith(' — Freebuff')) next = current.slice(0, -'Freebuff'.length) + cloneName;
    if (next !== current) document.title = next;
  };
  brandTitle();
  new MutationObserver(brandTitle).observe(document.head, { subtree: true, childList: true, characterData: true });
})();
"@
        Set-Content -LiteralPath $brandScript -Value $brandJs -Encoding UTF8
        if ($uiHtml -notmatch 'freebuff-clone-brand\.js') {
            $uiHtml = $uiHtml -replace '(</head>)', "    <script src=`"./freebuff-clone-brand.js`"></script>`r`n  `$1"
        }
        $escapedTitle = [System.Security.SecurityElement]::Escape($clone.Name)
        $uiHtml = $uiHtml -replace '<title>.*?</title>', "<title>$escapedTitle</title>"
        Set-Content -LiteralPath $uiIndex -Value $uiHtml -Encoding UTF8
    }

    $resourcesDir = Join-Path $cloneDir 'resources'
    if (-not (Test-Path $resourcesDir)) { New-Item -ItemType Directory -Path $resourcesDir -Force | Out-Null }
    if (Test-Path $appDir) { Remove-Item -Recurse -Force $appDir }

    $origAsar = Join-Path $src 'resources\app.asar'
    Copy-Item -LiteralPath $origAsar -Destination $asarPath -Force
    & $bun x '@electron/asar' extract $asarPath $appDir
    if ($LASTEXITCODE -ne 0) { return $false }

    $mainCjs = Join-Path $appDir 'electron\main.cjs'
    $content = Get-Content -LiteralPath $mainCjs -Raw

    # Render a simple local letter icon; no downloaded or generated artwork is needed.
    $buildDir = Join-Path $appDir 'build'
    if (-not (Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir -Force | Out-Null }
    $iconPng = Join-Path $buildDir 'clone-icon.png'
    $iconIco = Join-Path $buildDir 'clone-icon.ico'
    New-LetterIcon -Letter $letter -PngPath $iconPng -IcoPath $iconIco

    $jsBrowser = $chromePath -replace '\\', '\\'
    $jsProfile = ($profileDir -replace '\\', '\\') + '\\browser'

    $constantsJS = "`n// === FREEBUFF CLONE CONSTANTS ===`n"
    $jsCloneName = ($clone.Name -replace '\\', '\\\\' -replace "'", "\\'")
    $constantsJS += "const FREEBUFF_CLONE_NAME = '$jsCloneName'`n"
    $constantsJS += "const FREEBUFF_CLONE_AUTH_PARTITION = '$($clone.Partition)'`n"
    $constantsJS += "const FREEBUFF_CLONE_BROWSER = '$jsBrowser'`n"
    $constantsJS += "const FREEBUFF_CLONE_BROWSER_PROFILE = '$jsProfile'`n"
    $constantsJS += "// === END FREEBUFF CLONE CONSTANTS ===`n"
    $content = $content -replace "(const \{[\s\S]*?NO_SANDBOX,[\s\S]*?\} = require\('./linux-launch\.cjs'\))", "`$1$constantsJS"

    $newOE = @'

// === FREEBUFF CLONE PATCH: openExternal ===
function cloneLog(msg) {
  try {
    const logDir = require('node:path').join(process.env.LOCALAPPDATA || '', 'Freebuff-Clones', FREEBUFF_CLONE_NAME)
    require('node:fs').mkdirSync(logDir, { recursive: true })
    require('node:fs').appendFileSync(
      require('node:path').join(logDir, 'debug.log'),
      new Date().toISOString() + ' ' + msg + '\n'
    )
  } catch (_) {}
}
function openInChrome(url) {
  try {
    const { spawn } = require('node:child_process')
    const child = spawn(FREEBUFF_CLONE_BROWSER, [
      '--user-data-dir=' + FREEBUFF_CLONE_BROWSER_PROFILE,
      '--new-window', '--no-first-run', '--no-default-browser-check', String(url)
    ], { detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    cloneLog('openInChrome: ' + url)
    return true
  } catch (err) { cloneLog('openInChrome ERROR: ' + err.message); return false }
}
async function openExternal(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    cloneLog('openExternal: ' + url)
    return openInChrome(parsed.toString())
  } catch (err) { cloneLog('openExternal ERROR: ' + err.message); return false }
}
// === END FREEBUFF CLONE PATCH: openExternal ===
'@
    $content = $content -replace '(?s)/\*\* Hand an off-origin link.*?async function openExternal\(url\) \{.*?\n\}', $newOE

    $newHandlers = @'
  // === FREEBUFF CLONE PATCH: navigation interceptors ===
  win.webContents.on('will-redirect', (event, url) => {
    cloneLog('will-redirect: ' + url)
    if (!isAppUrl(url)) { event.preventDefault(); cloneLog('will-redirect BLOCKED: ' + url); openInChrome(url) }
  })
  win.webContents.on('will-navigate', (event, url) => {
    cloneLog('will-navigate: ' + url)
    if (!isAppUrl(url)) { event.preventDefault(); cloneLog('will-navigate BLOCKED: ' + url); openInChrome(url) }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    cloneLog('setWindowOpenHandler: ' + url)
    if (isAppUrl(url)) return { action: 'allow' }
    cloneLog('setWindowOpenHandler BLOCKED: ' + url); openInChrome(url); return { action: 'deny' }
  })
  win.webContents.on('did-navigate', (event, url) => { cloneLog('did-navigate: ' + url) })
  win.webContents.on('did-navigate-in-page', (event, url) => { cloneLog('did-navigate-in-page: ' + url) })
  // === END FREEBUFF CLONE PATCH: navigation interceptors ===
'@
    $content = $content -replace "(?s)  // New windows:.*?void openExternal\(url\)\s+\}\)", $newHandlers

    $content = $content -replace "ipcMain\.handle\('shell:openExternal', \(_event, url\) => openExternal\(url\)\)",
        "`n// === FREEBUFF CLONE PATCH: IPC ===`nipcMain.handle('shell:openExternal', (_event, url) => { cloneLog('IPC: ' + url); return openExternal(url) })`n// === END ==="

    $content = $content -replace "app\.setName\('Freebuff'\)", "app.setName('$jsCloneName')"
    $content = $content -replace "app\.setAppUserModelId\('com\.freebuff\.desktop'\)", "app.setAppUserModelId('com.freebuff.desktop.$($clone.Id)')"
    $content = $content -replace "title: 'Freebuff',", "title: '$jsCloneName',"
    $content = $content -replace "title: 'Quit Freebuff\?',", "title: 'Quit $jsCloneName?',"
    $content = $content -replace "message: 'Quit Freebuff\?'", "message: 'ออกจาก $jsCloneName หรือไม่?'"
    $content = $content -replace "detail: 'Any running agents will be stopped\.'", "detail: 'เอเจนต์ที่กำลังทำงานอยู่จะถูกหยุด'"
    $content = $content -replace "buttons: \['Quit', 'Cancel'\]", "buttons: ['ออก', 'ยกเลิก']"
    $content = $content -replace "const APP_ICON_PATH = path\.join\(PKG_DIR, 'build', 'icon\.png'\)", "const APP_ICON_PATH = path.join(PKG_DIR, 'build', 'clone-icon.png')"

    Set-Content -LiteralPath $mainCjs -Value $content -Encoding UTF8

    Remove-Item -LiteralPath $asarPath -Force -ErrorAction SilentlyContinue
    & $bun x '@electron/asar' pack $appDir $asarPath
    if ($LASTEXITCODE -ne 0) { return $false }

    $launchCmd = Join-Path $cloneDir "Launch $($clone.Name).cmd"
    $cmd = "@echo off`ntitle $($clone.Name)`nset `"FREEBUFF_CLONE_DISABLE_UPDATER=1`"`nset `"FREEBUFF_DESKTOP_STATE_PATH=$profileDir\desktop-state.json`"`nstart `"`" `"$cloneDir\Freebuff.exe`" --user-data-dir=`"$profileDir`""
    Set-Content -LiteralPath $launchCmd -Value $cmd -Encoding ASCII

    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut("$scriptDir\$($clone.Name).lnk")
    $sc.TargetPath = $launchCmd
    $sc.WorkingDirectory = $cloneDir
    $sc.Description = "Launch $($clone.Name)"
    $sc.IconLocation = "$iconIco,0"
    $sc.Save()

    return $true
}

if ($rebuildAll) {
    $config = Get-CloneConfig
    $ok = 0
    foreach ($clone in $config.clones) {
        $letter = Get-CloneLetter $clone
        if (-not $letter) { $letter = Get-NextCloneLetter $config }
        $clone | Add-Member -NotePropertyName IconLetter -NotePropertyValue $letter -Force
        $clone.Id = "freebuff-clone-$($letter.ToLowerInvariant())"
        Write-Host "Building $($clone.Name) [$letter]..."
        if (Build-SingleClone $clone) { $ok++ }
    }
    Save-CloneConfig $config
    Write-Host "Built $ok/$($config.clones.Count) clones."
    exit $(if ($ok -eq $config.clones.Count) { 0 } else { 1 })
}

# ==================== GUI ====================

$form = New-Object System.Windows.Forms.Form
$form.Text = "จัดการ Freebuff โคลน"
$form.Size = New-Object System.Drawing.Size(420, 480)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::White

# Title
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "จัดการ Freebuff โคลน"
$lblTitle.Font = New-Object System.Drawing.Font("Tahoma", 16, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = [System.Drawing.Color]::FromArgb(0, 120, 180)
$lblTitle.Size = New-Object System.Drawing.Size(380, 40)
$lblTitle.Location = New-Object System.Drawing.Point(20, 10)
$form.Controls.Add($lblTitle)

# List
$lblList = New-Object System.Windows.Forms.Label
$lblList.Text = "โคลนที่มีอยู่:"
$lblList.Font = New-Object System.Drawing.Font("Tahoma", 10)
$lblList.Size = New-Object System.Drawing.Size(200, 25)
$lblList.Location = New-Object System.Drawing.Point(20, 55)
$form.Controls.Add($lblList)

$listBox = New-Object System.Windows.Forms.ListBox
$listBox.Font = New-Object System.Drawing.Font("Tahoma", 12)
$listBox.Size = New-Object System.Drawing.Size(360, 130)
$listBox.Location = New-Object System.Drawing.Point(20, 80)
$form.Controls.Add($listBox)

# Button Add
$btnAdd = New-Object System.Windows.Forms.Button
$btnAdd.Text = "+ เพิ่ม"
$btnAdd.Font = New-Object System.Drawing.Font("Tahoma", 10)
$btnAdd.Size = New-Object System.Drawing.Size(85, 30)
$btnAdd.Location = New-Object System.Drawing.Point(20, 220)
$btnAdd.BackColor = [System.Drawing.Color]::FromArgb(40, 167, 69)
$btnAdd.ForeColor = [System.Drawing.Color]::White
$btnAdd.FlatStyle = "Flat"
$form.Controls.Add($btnAdd)

# Button Rename
$btnRename = New-Object System.Windows.Forms.Button
$btnRename.Text = "เปลี่ยนชื่อ"
$btnRename.Font = New-Object System.Drawing.Font("Tahoma", 10)
$btnRename.Size = New-Object System.Drawing.Size(85, 30)
$btnRename.Location = New-Object System.Drawing.Point(115, 220)
$btnRename.BackColor = [System.Drawing.Color]::FromArgb(255, 193, 7)
$btnRename.ForeColor = [System.Drawing.Color]::Black
$btnRename.FlatStyle = "Flat"
$form.Controls.Add($btnRename)

# Button Remove
$btnRemove = New-Object System.Windows.Forms.Button
$btnRemove.Text = "ลบ"
$btnRemove.Font = New-Object System.Drawing.Font("Tahoma", 10)
$btnRemove.Size = New-Object System.Drawing.Size(85, 30)
$btnRemove.Location = New-Object System.Drawing.Point(210, 220)
$btnRemove.BackColor = [System.Drawing.Color]::FromArgb(220, 53, 69)
$btnRemove.ForeColor = [System.Drawing.Color]::White
$btnRemove.FlatStyle = "Flat"
$form.Controls.Add($btnRemove)

# Button Build
$btnBuild = New-Object System.Windows.Forms.Button
$btnBuild.Text = "สร้าง/อัพเดท ทั้งหมด"
$btnBuild.Font = New-Object System.Drawing.Font("Tahoma", 10)
$btnBuild.Size = New-Object System.Drawing.Size(360, 35)
$btnBuild.Location = New-Object System.Drawing.Point(20, 265)
$btnBuild.BackColor = [System.Drawing.Color]::FromArgb(0, 123, 255)
$btnBuild.ForeColor = [System.Drawing.Color]::White
$btnBuild.FlatStyle = "Flat"
$form.Controls.Add($btnBuild)

# Button Launch
$btnLaunch = New-Object System.Windows.Forms.Button
$btnLaunch.Text = "เปิดใช้งาน"
$btnLaunch.Font = New-Object System.Drawing.Font("Tahoma", 10)
$btnLaunch.Size = New-Object System.Drawing.Size(360, 35)
$btnLaunch.Location = New-Object System.Drawing.Point(20, 310)
$btnLaunch.BackColor = [System.Drawing.Color]::FromArgb(23, 162, 184)
$btnLaunch.ForeColor = [System.Drawing.Color]::White
$btnLaunch.FlatStyle = "Flat"
$form.Controls.Add($btnLaunch)

# Status
$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "พร้อมใช้งาน"
$lblStatus.Font = New-Object System.Drawing.Font("Tahoma", 9)
$lblStatus.ForeColor = [System.Drawing.Color]::Gray
$lblStatus.Size = New-Object System.Drawing.Size(360, 60)
$lblStatus.Location = New-Object System.Drawing.Point(20, 360)
$form.Controls.Add($lblStatus)

# Load
Refresh-List $listBox

# ==================== Events ====================

# Add
$btnAdd.Add_Click({
    $addForm = New-Object System.Windows.Forms.Form
    $addForm.Text = "เพิ่มโคลนใหม่"
    $addForm.Size = New-Object System.Drawing.Size(350, 250)
    $addForm.StartPosition = "CenterParent"
    $addForm.FormBorderStyle = "FixedDialog"
    $addForm.MaximizeBox = $false
    $addForm.BackColor = [System.Drawing.Color]::White

    $lblName = New-Object System.Windows.Forms.Label
    $lblName.Text = "ชื่อ:"
    $lblName.Font = New-Object System.Drawing.Font("Tahoma", 10)
    $lblName.Location = New-Object System.Drawing.Point(20, 20)
    $lblName.Size = New-Object System.Drawing.Size(80, 25)
    $addForm.Controls.Add($lblName)

    $txtName = New-Object System.Windows.Forms.TextBox
    $txtName.Font = New-Object System.Drawing.Font("Tahoma", 11)
    $txtName.Size = New-Object System.Drawing.Size(260, 25)
    $txtName.Location = New-Object System.Drawing.Point(80, 18)
    $addForm.Controls.Add($txtName)

    $lblLetter = New-Object System.Windows.Forms.Label
    $lblLetter.Text = "ไอคอน:"
    $lblLetter.Font = New-Object System.Drawing.Font("Tahoma", 10)
    $lblLetter.Location = New-Object System.Drawing.Point(20, 55)
    $lblLetter.Size = New-Object System.Drawing.Size(80, 25)
    $addForm.Controls.Add($lblLetter)

    $cmbLetter = New-Object System.Windows.Forms.ComboBox
    $cmbLetter.Font = New-Object System.Drawing.Font("Tahoma", 11)
    $cmbLetter.Size = New-Object System.Drawing.Size(260, 25)
    $cmbLetter.Location = New-Object System.Drawing.Point(80, 53)
    $cmbLetter.DropDownStyle = "DropDownList"
    $currentConfig = Get-CloneConfig
    $usedLetters = @($currentConfig.clones | ForEach-Object { Get-CloneLetter $_ } | Where-Object { $_ })
    foreach ($letter in $availableLetters) {
        if ($usedLetters -notcontains $letter) { $cmbLetter.Items.Add($letter) | Out-Null }
    }
    if ($cmbLetter.Items.Count -gt 0) { $cmbLetter.SelectedIndex = 0 }
    $addForm.Controls.Add($cmbLetter)

    $btnOk = New-Object System.Windows.Forms.Button
    $btnOk.Text = "ตกลง"
    $btnOk.Font = New-Object System.Drawing.Font("Tahoma", 10)
    $btnOk.Size = New-Object System.Drawing.Size(120, 35)
    $btnOk.Location = New-Object System.Drawing.Point(80, 100)
    $btnOk.BackColor = [System.Drawing.Color]::FromArgb(40, 167, 69)
    $btnOk.ForeColor = [System.Drawing.Color]::White
    $btnOk.FlatStyle = "Flat"
    $addForm.Controls.Add($btnOk)

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text = "ยกเลิก"
    $btnCancel.Font = New-Object System.Drawing.Font("Tahoma", 10)
    $btnCancel.Size = New-Object System.Drawing.Size(120, 35)
    $btnCancel.Location = New-Object System.Drawing.Point(210, 100)
    $btnCancel.BackColor = [System.Drawing.Color]::FromArgb(108, 117, 125)
    $btnCancel.ForeColor = [System.Drawing.Color]::White
    $btnCancel.FlatStyle = "Flat"
    $addForm.Controls.Add($btnCancel)

    $btnOk.Add_Click({
        $name = $txtName.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($name)) {
            [System.Windows.Forms.MessageBox]::Show("ชื่อห้ามว่าง!", "Error", "OK", "Error")
            return
        }
        if ($name.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0) {
            [System.Windows.Forms.MessageBox]::Show("ชื่อมีอักขระที่ Windows ใช้เป็นชื่อไฟล์ไม่ได้", "Error", "OK", "Error")
            return
        }
        $config = Get-CloneConfig
        if ($config.clones | Where-Object { $_.Name -eq $name }) {
            [System.Windows.Forms.MessageBox]::Show("มี '$name' อยู่แล้ว!", "Error", "OK", "Error")
            return
        }

        $label = [string]$cmbLetter.SelectedItem
        if (-not $label) {
            [System.Windows.Forms.MessageBox]::Show("ตัวอักษร A-Z ถูกใช้ครบแล้ว", "Error", "OK", "Error")
            return
        }
        $id = "freebuff-clone-" + $label.ToLowerInvariant()

        $newClone = @{
            Name = $name
            Profile = "$name Profile"
            Partition = "persist:clone-$($label.ToLower())"
            Id = $id
            IconLetter = $label
        }

        $config.clones += $newClone
        Save-CloneConfig $config
        $lblStatus.Text = "กำลังสร้าง '$name'..."
        $form.Refresh()
        if (Build-SingleClone $newClone) {
            Refresh-List $listBox
            $lblStatus.Text = "เพิ่มและสร้าง '$name' เรียบร้อย!"
            $addForm.Close()
        } else {
            $config.clones = @($config.clones | Where-Object { $_.Name -ne $name })
            Save-CloneConfig $config
            [System.Windows.Forms.MessageBox]::Show("สร้าง '$name' ไม่สำเร็จ จึงไม่ได้เพิ่มรายการ", "Error", "OK", "Error")
        }
    })

    $btnCancel.Add_Click({ $addForm.Close() })
    $addForm.ShowDialog($form)
})

# Rename
$btnRename.Add_Click({
    if ($listBox.SelectedIndex -lt 0) {
        [System.Windows.Forms.MessageBox]::Show("เลือกโคลนก่อน!", "Error", "OK", "Warning")
        return
    }

    $config = Get-CloneConfig
    $old = $config.clones[$listBox.SelectedIndex]
    $oldName = $old.Name

    $renameForm = New-Object System.Windows.Forms.Form
    $renameForm.Text = "เปลี่ยนชื่อ $oldName"
    $renameForm.Size = New-Object System.Drawing.Size(350, 200)
    $renameForm.StartPosition = "CenterParent"
    $renameForm.FormBorderStyle = "FixedDialog"
    $renameForm.MaximizeBox = $false
    $renameForm.BackColor = [System.Drawing.Color]::White

    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = "ชื่อใหม่:"
    $lbl.Font = New-Object System.Drawing.Font("Tahoma", 10)
    $lbl.Location = New-Object System.Drawing.Point(20, 25)
    $lbl.Size = New-Object System.Drawing.Size(80, 25)
    $renameForm.Controls.Add($lbl)

    $txtNew = New-Object System.Windows.Forms.TextBox
    $txtNew.Font = New-Object System.Drawing.Font("Tahoma", 11)
    $txtNew.Size = New-Object System.Drawing.Size(240, 25)
    $txtNew.Location = New-Object System.Drawing.Point(80, 23)
    $txtNew.Text = $oldName
    $renameForm.Controls.Add($txtNew)

    $btnOk = New-Object System.Windows.Forms.Button
    $btnOk.Text = "ตกลง"
    $btnOk.Font = New-Object System.Drawing.Font("Tahoma", 10)
    $btnOk.Size = New-Object System.Drawing.Size(110, 35)
    $btnOk.Location = New-Object System.Drawing.Point(80, 70)
    $btnOk.BackColor = [System.Drawing.Color]::FromArgb(255, 193, 7)
    $btnOk.ForeColor = [System.Drawing.Color]::Black
    $btnOk.FlatStyle = "Flat"
    $renameForm.Controls.Add($btnOk)

    $btnCancel = New-Object System.Windows.Forms.Button
    $btnCancel.Text = "ยกเลิก"
    $btnCancel.Font = New-Object System.Drawing.Font("Tahoma", 10)
    $btnCancel.Size = New-Object System.Drawing.Size(110, 35)
    $btnCancel.Location = New-Object System.Drawing.Point(200, 70)
    $btnCancel.BackColor = [System.Drawing.Color]::FromArgb(108, 117, 125)
    $btnCancel.ForeColor = [System.Drawing.Color]::White
    $btnCancel.FlatStyle = "Flat"
    $renameForm.Controls.Add($btnCancel)

    $btnOk.Add_Click({
        $newName = $txtNew.Text.Trim()
        if ([string]::IsNullOrWhiteSpace($newName)) {
            [System.Windows.Forms.MessageBox]::Show("ชื่อห้ามว่าง!", "Error", "OK", "Error")
            return
        }
        if ($newName.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0) {
            [System.Windows.Forms.MessageBox]::Show("ชื่อมีอักขระที่ Windows ใช้เป็นชื่อไฟล์ไม่ได้", "Error", "OK", "Error")
            return
        }
        if ($newName -eq $oldName) {
            $renameForm.Close()
            return
        }
        $config2 = Get-CloneConfig
        if ($config2.clones | Where-Object { $_.Name -eq $newName }) {
            [System.Windows.Forms.MessageBox]::Show("มี '$newName' อยู่แล้ว!", "Error", "OK", "Error")
            return
        }

        # Kill process
        Get-CimInstance Win32_Process -Filter "Name='Freebuff.exe'" | Where-Object {
            $_.ExecutablePath -like "*Freebuff-Clones\$oldName*"
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

        # Rename directory
        $oldDir = Join-Path $cloneRoot $oldName
        $newDir = Join-Path $cloneRoot $newName
        if (Test-Path $oldDir) { Rename-Item -Path $oldDir -NewName $newName }

        # Rename profile
        $oldProfile = Join-Path $cloneRoot $old.Profile
        $newProfileDir = Join-Path $cloneRoot "$newName Profile"
        if (Test-Path $oldProfile) { Rename-Item -Path $oldProfile -NewName "$newName Profile" }

        # Remove old shortcut
        $oldShortcut = Join-Path $scriptDir "$oldName.lnk"
        if (Test-Path $oldShortcut) { Remove-Item -Force $oldShortcut }

        # Update config
        foreach ($c in $config2.clones) {
            if ($c.Name -eq $oldName) {
                $c.Name = $newName
                $c.Profile = "$newName Profile"
            }
        }
        Save-CloneConfig $config2

        # Rebuild to update launcher and shortcut
        $updatedClone = $config2.clones | Where-Object { $_.Name -eq $newName }
        Build-SingleClone $updatedClone

        Refresh-List $listBox
        $lblStatus.Text = "เปลี่ยนชื่อ '$oldName' -> '$newName' เรียบร้อย!"
        $renameForm.Close()
    })

    $btnCancel.Add_Click({ $renameForm.Close() })
    $renameForm.ShowDialog($form)
})

# Remove
$btnRemove.Add_Click({
    if ($listBox.SelectedIndex -lt 0) {
        [System.Windows.Forms.MessageBox]::Show("เลือกโคลนก่อน!", "Error", "OK", "Warning")
        return
    }

    $config = Get-CloneConfig
    $selected = $config.clones[$listBox.SelectedIndex]
    $result = [System.Windows.Forms.MessageBox]::Show("ลบ '$($selected.Name)' ทั้งหมด?", "ยืนยัน", "YesNo", "Question")

    if ($result -eq "Yes") {
        Get-CimInstance Win32_Process -Filter "Name='Freebuff.exe'" | Where-Object {
            $_.ExecutablePath -like "*Freebuff-Clones\$($selected.Name)*"
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

        $cloneDir = Join-Path $cloneRoot $selected.Name
        $profileDir = Join-Path $cloneRoot $selected.Profile
        if (Test-Path $cloneDir) { Remove-Item -Recurse -Force $cloneDir }
        if (Test-Path $profileDir) { Remove-Item -Recurse -Force $profileDir }

        $shortcutPath = Join-Path $scriptDir "$($selected.Name).lnk"
        if (Test-Path $shortcutPath) { Remove-Item -Force $shortcutPath }

        $config.clones = $config.clones | Where-Object { $_.Name -ne $selected.Name }
        Save-CloneConfig $config
        Refresh-List $listBox
        $lblStatus.Text = "ลบ '$($selected.Name)' เรียบร้อย!"
    }
})

# Build All
$btnBuild.Add_Click({
    $result = [System.Windows.Forms.MessageBox]::Show("สร้าง/อัพเดท โคลนทั้งหมด?`n(จะปิดโคลนที่กำลังทำงานก่อน)", "ยืนยัน", "YesNo", "Question")
    if ($result -eq "Yes") {
        Get-CimInstance Win32_Process -Filter "Name='Freebuff.exe'" | Where-Object {
            $_.ExecutablePath -like '*Freebuff-Clones*'
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

        $lblStatus.Text = "กำลังสร้าง/อัพเดท ทั้งหมด... รอสักครู่"
        $form.Refresh()

        $config = Get-CloneConfig
        $success = 0
        $fail = 0
        foreach ($c in $config.clones) {
            $lblStatus.Text = "กำลังสร้าง $($c.Name)..."
            $form.Refresh()
            if (Build-SingleClone $c) { $success++ } else { $fail++ }
        }

        Refresh-List $listBox
        $lblStatus.Text = "เสร็จสิ้น! สำเร็จ $success ตัว"
        if ($fail -gt 0) { $lblStatus.Text += " (ผิดพลาด $fail ตัว)" }
        [System.Windows.Forms.MessageBox]::Show("สร้าง/อัพเดท เสร็จสิ้น!`nสำเร็จ: $success ตัว`nผิดพลาด: $fail ตัว", "เสร็จสิ้น", "OK", "Information")
    }
})

# Launch
$btnLaunch.Add_Click({
    if ($listBox.SelectedIndex -lt 0) {
        [System.Windows.Forms.MessageBox]::Show("เลือกโคลนก่อน!", "Error", "OK", "Warning")
        return
    }

    $config = Get-CloneConfig
    $selected = $config.clones[$listBox.SelectedIndex]
    $launchCmd = Join-Path (Join-Path $cloneRoot $selected.Name) "Launch $($selected.Name).cmd"

    if (Test-Path $launchCmd) {
        Start-Process cmd.exe -ArgumentList "/c `"$launchCmd`""
        $lblStatus.Text = "กำลังเปิด $($selected.Name)..."
    } else {
        [System.Windows.Forms.MessageBox]::Show("ไม่เจอตัวเปิด!`nกด 'สร้าง/อัพเดท ทั้งหมด' ก่อน", "Error", "OK", "Error")
    }
})

$form.ShowDialog()
