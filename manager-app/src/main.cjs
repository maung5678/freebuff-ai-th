const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { ProxyAgent } = require('undici')
const local = process.env.LOCALAPPDATA || app.getPath('userData')
const cloneRoot = path.join(local, 'Freebuff-Clones')
const cloneConfig = path.join(cloneRoot, 'clones.json')
const legacyCloneRoot = 'D:\\This PC\\Ai\\clone Freebuff'
const legacyCloneConfig = path.join(legacyCloneRoot, 'clones.json')
const mainApp = path.join(local, 'Programs', '@codebufffreebuff-desktop')
const devRoot = path.resolve(__dirname, '..', '..')
const resourcesRoot = app.isPackaged ? process.resourcesPath : devRoot
const cloneProjectConfig = path.join(resourcesRoot, 'clone-engine', 'clones.json')
const fbth = path.join(resourcesRoot, app.isPackaged ? 'fbth' : 'Freebuff Thai', 'fbth.js')
const cloneEngine = path.join(resourcesRoot, 'clone-engine', 'Manage-Freebuff-Clones.ps1')
const UPDATE_REPO = 'maung5678/freebuff-ai-th'
const DESKTOP_UPDATE_URL = 'https://freebuff.com/api/desktop/updates/win-x64/latest.yml'
const DESKTOP_PUBLISHER = 'James Grugett'
const LANGUAGE_VERSION = '6'
let cachedRelease = null
let cachedDesktopUpdate = null
let operationActive = false
const updateProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy
let updateDispatcher = null
if (updateProxy) {
  try { updateDispatcher = new ProxyAgent(updateProxy) } catch (error) { console.warn('Freebuff Manager: ใช้ proxy สำหรับ GitHub ไม่ได้:', error.message) }
}
const activityLog = []
const activityFile = path.join(app.getPath('userData'), 'manager-activity.log')
try {
  const saved = fs.readFileSync(activityFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-300)
  for (const line of saved) { try { activityLog.push(JSON.parse(line)) } catch {} }
} catch {}
function recordLog(message, level = 'info') {
  const entry = { at: new Date().toLocaleTimeString(), level, message: String(message || '').trim() }
  activityLog.push(entry); if (activityLog.length > 300) activityLog.shift()
  try { fs.mkdirSync(path.dirname(activityFile), { recursive: true }); fs.appendFileSync(activityFile, JSON.stringify(entry) + '\n', 'utf8') } catch {}
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('activity-log', entry)
}
function fileVersion(file) {
  try {
    const output = require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Item -LiteralPath $env:FBTH_VERSION_FILE).VersionInfo.ProductVersion'], { encoding: 'utf8', windowsHide: true, timeout: 5000, env: { ...process.env, FBTH_VERSION_FILE: file } }).trim()
    return output.replace(/\.0$/, '') || 'ไม่ทราบ'
  } catch { return 'ไม่ทราบ' }
}

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) } catch { return fallback } }
function persistCloneConfig(config) {
  const data = JSON.stringify(config, null, 2) + '\n'
  fs.mkdirSync(cloneRoot, { recursive: true })
  fs.writeFileSync(cloneConfig, data, 'utf8')
  if (!app.isPackaged) { try { fs.mkdirSync(path.dirname(cloneProjectConfig), { recursive: true }); fs.writeFileSync(cloneProjectConfig, data, 'utf8') } catch {} }
}
function latestSnapshot(profile) {
  const p = path.join(cloneRoot, profile || '', 'freebuff-manager-usage.json')
  const legacy = path.join(legacyCloneRoot, profile || '', 'freebuff-manager-usage.json')
  const s = readJson(p, null) || readJson(legacy, null)
  if (!s) return null
  return { ...s, stale: Date.now() - Date.parse(s.capturedAt) > 15 * 60 * 1000 }
}
function listClones() {
  const cfg = readJson(cloneConfig, null) || readJson(cloneProjectConfig, null) || readJson(legacyCloneConfig, { clones: [] })
  const clones = new Map()
  for (const c of cfg.clones || []) if (c?.Name) clones.set(c.Name.toLocaleLowerCase(), c)
  try {
    for (const entry of fs.readdirSync(cloneRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || / Profile$/i.test(entry.name) || !/^Freebuff(?:\s|$)/i.test(entry.name)) continue
      const dir = path.join(cloneRoot, entry.name)
      if (!fs.existsSync(path.join(dir, 'resources', 'app.asar')) && !fs.existsSync(path.join(dir, 'Freebuff.exe'))) continue
      if (!clones.has(entry.name.toLocaleLowerCase())) {
        const letter = entry.name.match(/^Freebuff\s+([A-Z])$/i)?.[1]?.toUpperCase() || (/(?:^|\s)191(?:\s|$)/i.test(entry.name) ? 'Z' : '')
        clones.set(entry.name.toLocaleLowerCase(), { Name: entry.name, Profile: `${entry.name} Profile`, IconLetter: letter, Discovered: true })
      }
    }
  } catch {}
  try {
    for (const entry of fs.readdirSync(legacyCloneRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || / Profile$/i.test(entry.name) || !/^Freebuff(?:\s|$)/i.test(entry.name)) continue
      const dir = path.join(legacyCloneRoot, entry.name)
      if (!fs.existsSync(path.join(dir, 'resources', 'app.asar')) && !fs.existsSync(path.join(dir, 'Freebuff.exe'))) continue
      if (!clones.has(entry.name.toLocaleLowerCase())) {
        const letter = entry.name.match(/^Freebuff\s+([A-Z])$/i)?.[1]?.toUpperCase() || (/(?:^|\s)191(?:\s|$)/i.test(entry.name) ? 'Z' : '')
        clones.set(entry.name.toLocaleLowerCase(), { Name: entry.name, Profile: `${entry.name} Profile`, IconLetter: letter, AppRoot: legacyCloneRoot, Discovered: true })
      }
    }
  } catch {}
  return [...clones.values()]
    .map(c => ({ ...c, installed: fs.existsSync(path.join(c.AppRoot || cloneRoot, c.Name, 'resources', 'app.asar')) || fs.existsSync(path.join(c.AppRoot || cloneRoot, c.Name, 'Freebuff.exe')), usage: latestSnapshot(c.Profile || `${c.Name} Profile`) }))
    .sort((a, b) => a.Name.localeCompare(b.Name, undefined, { numeric: true, sensitivity: 'base' }))
}
function runFile(file, args = [], options = {}) {
  const label = `${path.basename(file)} ${args.join(' ')}`
  const { quietOutput = false, ...execOptions } = options
  recordLog(`กำลังทำงาน: ${label}`, 'running')
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...execOptions }, (error, stdout, stderr) => {
    const output = (stdout + stderr).trim()
    if (error) { const reason = (stderr || stdout || error.message).trim(); recordLog(`ผิดพลาด: ${label}\n${reason}`, 'error'); reject(new Error(reason)) }
    else { recordLog(`สำเร็จ: ${label}${output && !quietOutput ? `\n${output}` : ''}`, 'success'); resolve(output) }
  }))
}
function nodeRunner() {
  const bun = path.join(mainApp, 'resources', 'bun', 'bun.exe')
  if (fs.existsSync(bun)) return bun
  try { return require('node:child_process').execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim() } catch {}
  throw new Error('ไม่พบ Node.js หรือ Bun สำหรับเรียกตัวแปลภาษาไทย')
}
function powershellLiteral(value) { return `'${String(value).replace(/'/g, "''")}'` }
function progress(message, level = 'running') { recordLog(message, level) }
function cleanupAbandonedUpdateFolders() {
  const tempRoot = path.resolve(app.getPath('temp'))
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  let removed = 0
  try {
    for (const entry of fs.readdirSync(tempRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('freebuff-manager-update-')) continue
      const target = path.resolve(tempRoot, entry.name)
      if (path.dirname(target) !== tempRoot || fs.statSync(target).mtimeMs > cutoff) continue
      fs.rmSync(target, { recursive: true, force: true })
      removed++
    }
  } catch (error) { recordLog(`ลบไฟล์อัปเดตเก่าที่ค้างไม่สำเร็จ: ${error.message}`, 'error'); return }
  if (removed) recordLog(`ล้างโฟลเดอร์อัปเดตเก่าที่ค้าง ${removed} รายการแล้ว`, 'success')
}
async function ensureCloneClosed(appDir, profileDir) {
  const script = String.raw`$ErrorActionPreference='Stop'; $root=$env:FBTH_TARGET_APP.TrimEnd('\')+'\'; $profile=$env:FBTH_TARGET_PROFILE; @(Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) -or ($_.Name -match '^(chrome|msedge|bun|node)\.exe$' -and $_.CommandLine -and $_.CommandLine.IndexOf($profile,[StringComparison]::OrdinalIgnoreCase) -ge 0) } | ForEach-Object { $_.Name }) | ConvertTo-Json -Compress`
  const raw = await runFile('powershell.exe', ['-NoProfile', '-Command', script], { quietOutput: true, env: { ...process.env, FBTH_TARGET_APP: appDir, FBTH_TARGET_PROFILE: profileDir } })
  const parsed = JSON.parse(raw || '[]'), running = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  if (running.length) throw new Error(`กรุณาปิด ${path.basename(appDir)} และหน้าต่างเบราว์เซอร์ของโคลนนี้ก่อน แล้วลองอีกครั้ง (${[...new Set(running)].join(', ')})`)
}
async function ensureFreebuffClosed() {
  const checkProcesses = String.raw`$roots = @((Join-Path $env:LOCALAPPDATA 'Programs\@codebufffreebuff-desktop'), (Join-Path $env:LOCALAPPDATA 'Freebuff-Clones'), 'D:\This PC\Ai\clone Freebuff'); Get-CimInstance Win32_Process -Filter "Name='Freebuff.exe'" | Where-Object { $p=$_.ExecutablePath; $p -and ($roots | Where-Object { $p.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }) } | ForEach-Object { $_.ExecutablePath } | ConvertTo-Json -Compress`
  const raw = await runFile('powershell.exe', ['-NoProfile', '-Command', checkProcesses])
  let paths = []
  try { const parsed = JSON.parse(raw || '[]'); paths = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [] } catch { if (raw) paths = [raw] }
  if (paths.length) throw new Error(`กรุณาปิดแอป Freebuff ก่อนเริ่มอัปเดต: ${[...new Set(paths.map(p => path.basename(path.dirname(p))))].join(', ')}`)
}
async function runFbth(command) {
  return runFile(nodeRunner(), [fbth, command])
}
async function currentLanguageState() {
  const output = await runFile(nodeRunner(), [fbth, 'status'], { quietOutput: true })
  const clean = output.replace(/\x1B\[[0-9;]*m/g, '')
  const stale = /fbth-th\.js:\s*เก่า\/ไม่มี|fbth-dict\.json:\s*เก่า\/ไม่มี|→ รัน "fbth install"/.test(clean)
  return { stale, current: stale ? 'ต้องซิงก์' : LANGUAGE_VERSION }
}
function createWindow() {
  const win = new BrowserWindow({ width: 1180, height: 760, minWidth: 960, minHeight: 620, backgroundColor: '#090d14', titleBarStyle: 'hiddenInset', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
  win.loadFile(path.join(__dirname, 'index.html'))
}
ipcMain.handle('overview', async () => ({ clones: listClones(), mainInstalled: fs.existsSync(path.join(mainApp, 'Freebuff.exe')), mainVersion: fileVersion(path.join(mainApp, 'Freebuff.exe')), version: app.getVersion() }))
ipcMain.handle('activity-log', async () => activityLog)
ipcMain.handle('record-error', async (_e, message) => { recordLog(message, 'error'); return true })
ipcMain.handle('run', async (_e, action, payload = {}) => {
  if (operationActive) throw new Error('กำลังทำงานอยู่ กรุณารอให้เสร็จก่อน')
  operationActive = true
  try {
  recordLog(`รับคำสั่ง: ${action}${payload?.name ? ` · ${payload.name}` : ''}`)
  if (action === 'language-install') return { message: await runFbth('install') }
  if (action === 'language-status') return { message: await runFbth('status') }
  if (action === 'language-remove') return { message: await runFbth('uninstall') }
  if (action === 'open-main') {
    const exe = path.join(mainApp, 'Freebuff.exe')
    if (!fs.existsSync(exe)) throw new Error(`ไม่พบแอปหลักที่ ${exe}`)
    const child = spawn(exe, [], { cwd: mainApp, detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', error => recordLog(`เปิดแอปหลักไม่สำเร็จ: ${error.message}`, 'error')); child.unref()
    recordLog(`เปิดแอปหลัก Freebuff ${fileVersion(exe)}`)
    return { message: 'เปิดแอปหลักแล้ว', silent: true }
  }
  if (action === 'delete-clone-registration') {
    const cfg = readJson(cloneConfig, null) || readJson(cloneProjectConfig, null) || readJson(legacyCloneConfig, { clones: [] })
    const match = listClones().find(c => c?.Name === payload.name)
    if (!match) throw new Error('ไม่พบรายการโคลน')
    cfg.clones = (cfg.clones || []).filter(c => c?.Name !== payload.name)
    persistCloneConfig(cfg)
    return { message: `ถอน ${match.Name} ออกจากรายการแล้ว ไฟล์แอปและโปรไฟล์ยังเก็บไว้ที่ ${cloneRoot}` }
  }
  if (action === 'delete-clone-files') {
    const cfg = readJson(cloneConfig, null) || readJson(cloneProjectConfig, null) || readJson(legacyCloneConfig, { clones: [] })
    const match = listClones().find(c => c?.Name === payload.name)
    if (!match) throw new Error('ไม่พบรายการโคลนในทะเบียน')
    const base = match.AppRoot || cloneRoot, profileRoot = match.ProfileRoot || (base === legacyCloneRoot ? legacyCloneRoot : cloneRoot)
    const allowedRoots = [cloneRoot, legacyCloneRoot].map(p => path.resolve(p).toLocaleLowerCase())
    const resolvedBase = path.resolve(base), resolvedProfileRoot = path.resolve(profileRoot)
    if (!allowedRoots.includes(resolvedBase.toLocaleLowerCase()) || !allowedRoots.includes(resolvedProfileRoot.toLocaleLowerCase())) throw new Error('ตำแหน่งโคลนไม่อยู่ในโฟลเดอร์ที่ Manager ดูแล จึงยกเลิกการลบ')
    if (!/^Freebuff(?:\s|$)/i.test(match.Name)) throw new Error('ชื่อโคลนไม่ถูกต้อง จึงยกเลิกการลบ')
    const appRootPath = resolvedBase + path.sep, profileRootPath = resolvedProfileRoot + path.sep
    const targets = [path.resolve(base, match.Name), path.resolve(profileRoot, match.Profile || `${match.Name} Profile`)]
    if (!targets[0].startsWith(appRootPath) || targets[0] === path.resolve(base) || !targets[1].startsWith(profileRootPath) || targets[1] === path.resolve(profileRoot)) throw new Error('เส้นทางไม่ปลอดภัย จึงยกเลิกการลบ')
    const appExe = path.join(targets[0], 'Freebuff.exe')
    const confirmedApp = fs.existsSync(path.join(targets[0], 'resources', 'app.asar')) || fs.existsSync(appExe)
    const registered = (cfg.clones || []).some(c => c.Name === match.Name)
    if (!confirmedApp && !registered) throw new Error('ไม่พบไฟล์แอปของโคลน จึงไม่ลบโฟลเดอร์ที่ไม่ยืนยัน')
    await ensureCloneClosed(targets[0], targets[1])
    progress(`กำลังลบแอปและโปรไฟล์ ${match.Name}`)
    try {
      await fs.promises.rm(targets[0], { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
      await fs.promises.rm(targets[1], { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
    } catch (error) { throw new Error(`ลบ ${match.Name} ไม่ครบ: กรุณาปิดแอป/เบราว์เซอร์และหน้าต่างที่ใช้โฟลเดอร์ของโคลนนี้ แล้วลองอีกครั้ง (${error.code || error.message})`) }
    cfg.clones = (cfg.clones || []).filter(c => c?.Name !== payload.name)
    fs.rmSync(path.join(cloneRoot, `${match.Name}.lnk`), { force: true })
    fs.rmSync(path.join(resolvedBase, `${match.Name}.lnk`), { force: true })
    persistCloneConfig(cfg)
    progress(`ลบแอปและโปรไฟล์ ${match.Name} สำเร็จ`, 'success')
    return { message: `ลบไฟล์แอปและโปรไฟล์ ${match.Name} แล้ว` }
  }
  if (action === 'open-clone') {
    const requested = String(payload.name || '').trim()
    const clone = listClones().find(c => String(c.Name || '').trim().toLocaleLowerCase() === requested.toLocaleLowerCase())
    if (!clone) {
      const available = listClones().map(c => c.Name).join(', ') || 'ไม่มีรายการ'
      throw new Error(`ไม่พบโคลน "${requested || '(ไม่ได้ระบุชื่อ)'}" ในรายการปัจจุบัน · รายการที่พบ: ${available}`)
    }
    const cloneBase = clone.AppRoot || cloneRoot
    const cloneDir = path.join(cloneBase, clone.Name)
    const profileRoot = clone.ProfileRoot || (cloneBase === legacyCloneRoot ? legacyCloneRoot : cloneRoot)
    const profileDir = path.join(profileRoot, clone.Profile || `${clone.Name} Profile`)
    const cloneExe = path.join(cloneDir, 'Freebuff.exe')
    if (!fs.existsSync(cloneExe) || !fs.existsSync(path.join(cloneDir, 'resources', 'app.asar'))) throw new Error(`ไม่พบไฟล์แอปของ ${clone.Name} จึงไม่เปิดแอปหลักแทน โปรดกดอัปเดตทั้งหมดเพื่อซ่อมโคลน`)
    const env = {
      ...process.env,
      FREEBUFF_CLONE_DISABLE_UPDATER: '1',
      FREEBUFF_DESKTOP_STATE_PATH: path.join(profileDir, 'desktop-state.json'),
    }
    // ต้องตรงกับ Launch <clone>.cmd ของ clone engine ทุกค่า มิฉะนั้น Electron อาจใช้บัญชีหลัก
    fs.mkdirSync(profileDir, { recursive: true })
    const child = spawn(cloneExe, [`--user-data-dir=${profileDir}`], { cwd: cloneDir, env, detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', error => recordLog(`เปิดโคลน ${clone.Name} ไม่สำเร็จ: ${error.message}`, 'error')); child.unref()
    recordLog(`เปิดโคลน ${clone.Name} ด้วยโปรไฟล์ ${profileDir}`)
    return { message: `เปิด ${clone.Name} แล้ว`, silent: true }
  }
  if (action === 'rebuild-clones') {
    if (!fs.existsSync(cloneEngine)) throw new Error('ไม่พบ clone engine ในแพ็กเกจ')
    await ensureFreebuffClosed()
    progress('กำลังซิงก์ไฟล์แอปหลักไปยังโคลน')
    let message
    try { message = await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cloneEngine, '--rebuild-all', '--clone-only', '--clone-root', cloneRoot]) }
    catch (error) {
      const raw = await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cloneEngine, '--list-json', '--clone-only', '--clone-root', cloneRoot])
      const parsed = JSON.parse(raw || '{}'), found = Array.isArray(parsed.clones) ? parsed.clones : parsed.clones ? [parsed.clones] : []
      if (!found.length) throw error
      const previous = readJson(cloneConfig, null)
      const merged = new Map([...(previous?.clones || []), ...found.map(c => ({ ...c, AppRoot: c.AppRoot || cloneRoot, ProfileRoot: c.ProfileRoot || cloneRoot }))].map(c => [c.Name.toLocaleLowerCase(), c]))
      persistCloneConfig({ clones: [...merged.values()] })
      message = await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cloneEngine, '--rebuild-all', '--clone-only', '--clone-root', cloneRoot])
    }
    return { message }
  }
  if (action === 'add-clone') {
    if (!fs.existsSync(cloneEngine)) throw new Error('ไม่พบ clone engine ในแพ็กเกจ')
    const name = String(payload.name || '').trim()
    if (!/^Freebuff\s+[A-Za-z0-9][A-Za-z0-9 _-]{0,30}$/.test(name)) throw new Error('ชื่อควรขึ้นต้นด้วย Freebuff และใช้ตัวอักษร/ตัวเลขเท่านั้น')
    if (listClones().some(c => c.Name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('มีชื่อนี้อยู่แล้ว')
    const newAppDir = path.join(cloneRoot, name), newProfileDir = path.join(cloneRoot, `${name} Profile`)
    if (fs.existsSync(newAppDir) || fs.existsSync(newProfileDir)) throw new Error('มีโฟลเดอร์แอปหรือโปรไฟล์ชื่อนี้อยู่แล้ว กรุณาตรวจรายการโคลนก่อน')
    const used = new Set(listClones().map(c => c.IconLetter).filter(Boolean))
    const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(x => !used.has(x))
    if (!letter) throw new Error('ไม่มีตัวอักษรไอคอนว่าง')
    progress(`กำลังสร้างโคลน ${name}`)
    const cfg = readJson(cloneConfig, null) || readJson(cloneProjectConfig, null) || readJson(legacyCloneConfig, { clones: [] })
    const clone = { Name: name, Id: `freebuff-clone-${letter.toLowerCase()}`, Profile: `${name} Profile`, Partition: `persist:clone-${letter.toLowerCase()}`, IconLetter: letter }
    cfg.clones = [...(cfg.clones || []), clone]
    const existing = new Set(cfg.clones.map(c => c.Name.toLocaleLowerCase()))
    cfg.clones = [...cfg.clones, ...listClones().filter(c => c.AppRoot === legacyCloneRoot && !existing.has(c.Name.toLocaleLowerCase())).map(c => ({ ...c, AppRoot: legacyCloneRoot, ProfileRoot: legacyCloneRoot }))]
    persistCloneConfig(cfg)
    try {
      const message = await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cloneEngine, '--rebuild-all', '--clone-only', '--clone-root', cloneRoot, '--clone-name', name])
      if (!fs.existsSync(path.join(newAppDir, 'Freebuff.exe')) || !fs.existsSync(path.join(newAppDir, 'resources', 'app.asar'))) throw new Error('clone engine จบการทำงานแต่ไม่พบไฟล์แอปโคลนที่สร้าง')
      progress(`สร้างโคลน ${name} สำเร็จ`, 'success')
      return { message }
    } catch (error) {
      try { fs.rmSync(newAppDir, { recursive: true, force: true }); fs.rmSync(newProfileDir, { recursive: true, force: true }); fs.rmSync(path.join(cloneRoot, `${name}.lnk`), { force: true }) }
      catch (cleanupError) { recordLog(`เก็บไฟล์โคลนที่สร้างไม่สำเร็จไม่หมด: ${cleanupError.message}`, 'error') }
      cfg.clones = cfg.clones.filter(c => c.Name !== name); persistCloneConfig(cfg); throw error
    }
  }
  if (action === 'rename-clone') {
    const oldName = String(payload.oldName || ''), name = String(payload.name || '').trim()
    if (!/^Freebuff\s+[A-Za-z0-9][A-Za-z0-9 _-]{0,30}$/.test(name)) throw new Error('ชื่อควรขึ้นต้นด้วย Freebuff และใช้ตัวอักษร/ตัวเลขเท่านั้น')
    if (listClones().some(c => c.Name.toLocaleLowerCase() === name.toLocaleLowerCase() && c.Name !== oldName)) throw new Error('มีชื่อนี้อยู่แล้ว')
    const discovered = listClones().find(x => x.Name.toLocaleLowerCase() === oldName.toLocaleLowerCase())
    if (!discovered) throw new Error('ไม่พบรายการโคลนที่ต้องการเปลี่ยนชื่อ')
    const cfg = readJson(cloneConfig, null) || readJson(cloneProjectConfig, null) || readJson(legacyCloneConfig, { clones: [] })
    const roots = [cloneRoot, legacyCloneRoot].map(p => path.resolve(p).toLocaleLowerCase())
    const root = path.resolve(discovered.AppRoot || cloneRoot)
    const profileRoot = path.resolve(discovered.ProfileRoot || (root.toLocaleLowerCase() === path.resolve(legacyCloneRoot).toLocaleLowerCase() ? legacyCloneRoot : cloneRoot))
    if (!roots.includes(root.toLocaleLowerCase()) || !roots.includes(profileRoot.toLocaleLowerCase())) throw new Error('ตำแหน่งโคลนไม่อยู่ในโฟลเดอร์ที่ Manager ดูแล จึงยกเลิกการเปลี่ยนชื่อ')
    progress(`กำลังเปลี่ยนชื่อ ${oldName} เป็น ${name}`)
    const oldProfileName = discovered.Profile || `${oldName} Profile`, newProfileName = `${name} Profile`
    const oldProfile = path.resolve(profileRoot, oldProfileName), newProfile = path.resolve(profileRoot, newProfileName)
    const oldDir = path.resolve(root, discovered.Name), newDir = path.resolve(root, name)
    const isChild = (parent, target) => { const rel = path.relative(parent, target); return !!rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) }
    if (!isChild(root, oldDir) || !isChild(root, newDir) || !isChild(profileRoot, oldProfile) || !isChild(profileRoot, newProfile)) throw new Error('เส้นทางเปลี่ยนชื่อไม่ปลอดภัย จึงยกเลิก')
    await ensureCloneClosed(oldDir, oldProfile)
    if (!fs.existsSync(path.join(oldDir, 'Freebuff.exe')) || !fs.existsSync(path.join(oldDir, 'resources', 'app.asar'))) throw new Error('ไฟล์แอปโคลนหายไป กรุณากดอัปเดตทั้งหมดเพื่อซ่อมก่อนเปลี่ยนชื่อ')
    if (fs.existsSync(newDir) || fs.existsSync(newProfile)) throw new Error('มีโฟลเดอร์แอปหรือโปรไฟล์ปลายทางอยู่แล้ว จึงไม่เปลี่ยนชื่อเพื่อป้องกันข้อมูลทับกัน')
    const oldShortcut = path.join(cloneRoot, `${oldName}.lnk`), newShortcut = path.join(cloneRoot, `${name}.lnk`)
    const oldClones = Array.isArray(cfg.clones) ? cfg.clones : []
    const targetConfig = oldClones.find(c => c.Name?.toLocaleLowerCase() === oldName.toLocaleLowerCase()) || discovered
    const updatedConfig = { ...targetConfig, Name: name, Profile: newProfileName, AppRoot: root, ProfileRoot: profileRoot, Discovered: false }
    const nextClones = oldClones.filter(c => c.Name?.toLocaleLowerCase() !== oldName.toLocaleLowerCase())
    nextClones.push(updatedConfig)
    const nextCfg = { ...cfg, clones: nextClones }
    const backupDir = path.join(root, `.manager-rename-${crypto.randomUUID()}`)
    const backupShortcut = `${backupDir}.lnk`
    let movedApp = false, movedProfile = false, movedShortcut = false, committed = false
    try {
      fs.renameSync(oldDir, backupDir); movedApp = true
      if (fs.existsSync(oldProfile)) { fs.renameSync(oldProfile, newProfile); movedProfile = true }
      if (fs.existsSync(oldShortcut)) { fs.renameSync(oldShortcut, backupShortcut); movedShortcut = true }
      persistCloneConfig(nextCfg)
      if (!fs.existsSync(cloneEngine)) throw new Error('ไม่พบ clone engine สำหรับสร้างแอปด้วยชื่อใหม่')
      await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cloneEngine, '--rebuild-all', '--clone-only', '--clone-root', cloneRoot, '--clone-name', name])
      if (!fs.existsSync(path.join(newDir, 'Freebuff.exe')) || !fs.existsSync(path.join(newDir, 'resources', 'app.asar'))) throw new Error('สร้างโคลนชื่อใหม่ไม่ครบ จึงคืนชื่อเดิม')
      committed = true
      progress(`เปลี่ยนชื่อโคลนเป็น ${name} สำเร็จ`, 'success')
      return { message: `เปลี่ยนชื่อเป็น ${name} แล้ว โปรไฟล์เดิมถูกเก็บไว้` }
    } catch (error) {
      try { fs.rmSync(newShortcut, { force: true }); if (movedShortcut) fs.renameSync(backupShortcut, oldShortcut) }
      catch (rollbackError) { recordLog(`คืนทางลัดไม่สำเร็จ: ${rollbackError.message}`, 'error') }
      try { if (movedProfile && fs.existsSync(newProfile)) fs.renameSync(newProfile, oldProfile) } catch {}
      try { if (movedApp) { fs.rmSync(newDir, { recursive: true, force: true }); fs.renameSync(backupDir, oldDir) } }
      catch (rollbackError) { recordLog(`คืนโฟลเดอร์ไม่สำเร็จ เก็บแอปเดิมไว้ที่ ${backupDir}: ${rollbackError.message}`, 'error') }
      try { persistCloneConfig(cfg) } catch (rollbackError) { recordLog(`คืนทะเบียนโคลนหลังเปลี่ยนชื่อไม่สำเร็จ: ${rollbackError.message}`, 'error') }
      throw error
    } finally {
      if (committed && fs.existsSync(backupDir)) {
        try { await fs.promises.rm(backupDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); fs.rmSync(backupShortcut, { force: true }) }
        catch (error) { recordLog(`เปลี่ยนชื่อแล้ว แต่ยังเก็บสำเนาแอปเก่าไว้ที่ ${backupDir}: ${error.message}`, 'error') }
      }
    }
  }
  throw new Error('คำสั่งไม่รองรับ')
  } catch (error) { recordLog(error.message, 'error'); throw error }
  finally { operationActive = false }
})
async function updateFetch(url, options = {}) {
  try { return await fetch(url, { ...options, ...(updateDispatcher ? { dispatcher: updateDispatcher } : {}) }) }
  catch (error) {
    const causeCode = error?.cause?.code || error?.cause?.cause?.code
    const detail = causeCode ? ` (${causeCode})` : ''
    throw new Error(`เชื่อมต่อเซิร์ฟเวอร์อัปเดตไม่สำเร็จ${detail}: ตรวจสอบอินเทอร์เน็ตหรือ Proxy แล้วลองใหม่`, { cause: error })
  }
}
async function latestRelease() {
  const response = await updateFetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Freebuff-Manager' } })
  if (!response.ok) throw new Error(`GitHub ตอบกลับ ${response.status}`)
  const release = await response.json()
  cachedRelease = release
  return release
}
async function latestDesktopUpdate() {
  const response = await updateFetch(DESKTOP_UPDATE_URL, { headers: { 'User-Agent': 'Freebuff-Manager' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`เซิร์ฟเวอร์อัปเดต Freebuff ตอบกลับ ${response.status}`)
  const text = await response.text()
  const value = key => text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  const version = value('version'), file = value('path')
  const digest = value('sha512') || text.match(/^\s+sha512:\s*(.+)$/m)?.[1]?.trim()
  const size = Number(value('size') || text.match(/^\s+size:\s*(\d+)$/m)?.[1] || 0)
  if (!version || !file || !digest || !/^[\w.-]+\.exe$/i.test(file)) throw new Error('ข้อมูล latest.yml ของ Freebuff ไม่ครบหรือไม่ถูกต้อง')
  const update = { version: normalizedVersion(version), file, digest, size, url: new URL(file, response.url).href }
  cachedDesktopUpdate = update
  return update
}
function normalizedVersion(value) { return String(value || '').replace(/^[^\d]*/, '').replace(/[^\d.].*$/, '') || '0.0.0' }
function newer(a, b) {
  const av = normalizedVersion(a).split('.').map(Number), bv = normalizedVersion(b).split('.').map(Number)
  for (let i = 0; i < Math.max(av.length, bv.length); i++) { if ((av[i] || 0) !== (bv[i] || 0)) return (av[i] || 0) > (bv[i] || 0) }
  return false
}
function classifyAssets(release) {
  const assets = release.assets || []
  const manager = assets.find(a => /Freebuff.Manager.Setup.*\.exe$/i.test(a.name))
  const language = assets.find(a => /Freebuff.Thai.Pack.*\.zip$/i.test(a.name))
  const languageVersion = language?.name.match(/(?:Pack[-_ ]?v?|language[-_ ])(\d+(?:\.\d+){0,2})/i)?.[1] || normalizedVersion(release.tag_name)
  return { manager, language, managerVersion: normalizedVersion(release.tag_name), languageVersion }
}
async function downloadVerified(asset, destination) {
  if (!asset?.browser_download_url) throw new Error('Release ไม่มีไฟล์อัปเดตที่ต้องการ')
  const response = await updateFetch(asset.browser_download_url, { headers: { 'User-Agent': 'Freebuff-Manager' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ (${response.status})`)
  const data = Buffer.from(await response.arrayBuffer())
  const actual = crypto.createHash('sha256').update(data).digest('hex').toLowerCase()
  const expected = String(asset.digest || '').replace(/^sha256:/i, '').toLowerCase()
  if (!expected) throw new Error('GitHub Release ไม่มี SHA-256 digest จึงยกเลิกเพื่อความปลอดภัย')
  if (actual !== expected) throw new Error('SHA-256 ไม่ตรงกับ GitHub Release จึงยกเลิกการติดตั้ง')
  fs.writeFileSync(destination, data)
}
async function downloadDesktopVerified(update, destination) {
  progress(`กำลังดาวน์โหลด Freebuff ${update.version}${update.size ? ` (${Math.round(update.size / 1024 / 1024)} MB)` : ''}`)
  const response = await updateFetch(update.url, { headers: { 'User-Agent': 'Freebuff-Manager' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`ดาวน์โหลด Freebuff ไม่สำเร็จ (${response.status})`)
  const hash = crypto.createHash('sha512')
  await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk) } }), fs.createWriteStream(destination))
  const actual = hash.digest('base64')
  const actualSize = fs.statSync(destination).size
  if (update.size && actualSize !== update.size) throw new Error('ขนาดไฟล์ Freebuff ไม่ตรงกับ latest.yml')
  if (actual !== update.digest) throw new Error('SHA-512 ของ Freebuff ไม่ตรงกับ latest.yml จึงยกเลิกการติดตั้ง')
  progress(`ดาวน์โหลด Freebuff ${Math.round(actualSize / 1024 / 1024)} MB และตรวจ SHA-512 ผ่านแล้ว`, 'success')
}
async function verifyDesktopSignature(installer) {
  progress('กำลังตรวจลายเซ็นผู้เผยแพร่ Freebuff')
  const script = `$sig = Get-AuthenticodeSignature -LiteralPath ${powershellLiteral(installer)}; [pscustomobject]@{ Status=$sig.Status.ToString(); Subject=$sig.SignerCertificate.Subject } | ConvertTo-Json -Compress`
  const raw = await runFile('powershell.exe', ['-NoProfile', '-Command', script])
  let signature
  try { signature = JSON.parse(raw) } catch { throw new Error('อ่านผลตรวจลายเซ็น Freebuff ไม่สำเร็จ') }
  if (signature.Status !== 'Valid' || !String(signature.Subject).includes(DESKTOP_PUBLISHER)) throw new Error('ลายเซ็น Freebuff ไม่ถูกต้องหรือผู้เผยแพร่ไม่ตรง จึงยกเลิกการติดตั้ง')
  progress(`ลายเซ็นถูกต้อง: ${DESKTOP_PUBLISHER}`, 'success')
}
async function installDesktopUpdate(update, temp) {
  await ensureFreebuffClosed()
  const installer = path.join(temp, update.file)
  await downloadDesktopVerified(update, installer)
  await verifyDesktopSignature(installer)
  progress(`กำลังอัปเดตแอปหลัก Freebuff → ${update.version}`)
  await runFile(installer, ['--updated', '/S', `/D=${mainApp}`], { timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 })
  const installed = fileVersion(path.join(mainApp, 'Freebuff.exe'))
  if (normalizedVersion(installed) !== normalizedVersion(update.version)) throw new Error(`ตัวติดตั้งจบแล้ว แต่เวอร์ชันแอปหลักเป็น ${installed} (คาด ${update.version})`)
  progress(`อัปเดตแอปหลักสำเร็จ · Freebuff ${installed}`, 'success')
}
ipcMain.handle('check-updates', async () => {
  progress('กำลังตรวจสอบเวอร์ชัน Freebuff, Mod ภาษาไทย และ Manager')
  const release = await latestRelease(), found = classifyAssets(release)
  const desktopUpdate = await latestDesktopUpdate()
  const languageState = await currentLanguageState()
  const currentDesktop = fileVersion(path.join(mainApp, 'Freebuff.exe'))
  const clones = listClones()
  const managerAvailable = !!found.manager && newer(found.managerVersion, app.getVersion())
  const languageAvailable = !!found.language && (newer(found.languageVersion, LANGUAGE_VERSION) || languageState.stale)
  const desktopAvailable = fs.existsSync(path.join(mainApp, 'Freebuff.exe')) && newer(desktopUpdate.version, currentDesktop)
  progress(`ตรวจเสร็จ · Freebuff ${currentDesktop}${desktopAvailable ? ` → ${desktopUpdate.version}` : ''} · ภาษาไทย ${languageState.current}${languageAvailable ? ` → ${found.languageVersion}` : ''} · Manager ${app.getVersion()}${managerAvailable ? ` → ${found.managerVersion}` : ''}`, 'success')
  return { repository: UPDATE_REPO, notes: release.body || '', syncClones: clones.length > 0 && (desktopAvailable || clones.some(c => c.installed && fileVersion(path.join(c.AppRoot || cloneRoot, c.Name, 'Freebuff.exe')) !== currentDesktop)),
    desktop: { current: currentDesktop, latest: desktopUpdate.version, available: desktopAvailable },
    manager: { current: app.getVersion(), latest: found.managerVersion, available: !!found.manager && newer(found.managerVersion, app.getVersion()) },
    language: { current: languageState.current, latest: found.languageVersion, available: languageAvailable } }
})
ipcMain.handle('update-all', async () => {
  if (operationActive) throw new Error('มีงานกำลังทำอยู่ กรุณารอให้เสร็จก่อน')
  operationActive = true
  let temp = null, preserveTemp = false
  progress('เริ่มกระบวนการอัปเดตทั้งหมด')
  try {
    await ensureFreebuffClosed()
    const release = cachedRelease || await latestRelease(), found = classifyAssets(release)
    const desktopUpdate = cachedDesktopUpdate || await latestDesktopUpdate()
    temp = fs.mkdtempSync(path.join(app.getPath('temp'), 'freebuff-manager-update-'))
    const currentDesktop = fileVersion(path.join(mainApp, 'Freebuff.exe'))
    if (newer(desktopUpdate.version, currentDesktop)) await installDesktopUpdate(desktopUpdate, temp)
    else progress(`แอปหลักเป็นเวอร์ชันล่าสุด (${currentDesktop})`, 'success')

    progress('กำลังซิงก์แอปหลักเวอร์ชันปัจจุบันไปยังโคลน')
    if (listClones().length) {
      if (!fs.existsSync(cloneEngine)) throw new Error('ไม่พบ clone engine ในแพ็กเกจ')
      try { await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cloneEngine, '--rebuild-all', '--clone-only', '--clone-root', cloneRoot]) }
      catch (error) {
        const raw = await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cloneEngine, '--list-json', '--clone-only', '--clone-root', cloneRoot])
        const parsed = JSON.parse(raw || '{}'), foundClones = Array.isArray(parsed.clones) ? parsed.clones : parsed.clones ? [parsed.clones] : []
        if (!foundClones.length) throw error
        const previous = readJson(cloneConfig, null)
        const merged = new Map([...(previous?.clones || []), ...foundClones.map(c => ({ ...c, AppRoot: c.AppRoot || cloneRoot, ProfileRoot: c.ProfileRoot || cloneRoot }))].map(c => [c.Name.toLocaleLowerCase(), c]))
        persistCloneConfig({ clones: [...merged.values()] })
        await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cloneEngine, '--rebuild-all', '--clone-only', '--clone-root', cloneRoot])
      }
      progress(`ซิงก์โคลน ${listClones().length} รายการสำเร็จ`, 'success')
    } else progress('ยังไม่มีโคลนให้ซิงก์', 'info')

    if (found.language) {
      progress(`กำลังดาวน์โหลด Mod ภาษาไทย ${found.languageVersion}`)
      const zip = path.join(temp, found.language.name)
      await downloadVerified(found.language, zip)
      progress('ตรวจ SHA-256 ของ Language Pack ผ่านแล้ว', 'success')
      progress('กำลังแตกและติดตั้งภาษาไทยให้แอปหลักและโคลน')
      const unpacked = path.join(temp, 'language')
      await runFile('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${powershellLiteral(zip)} -DestinationPath ${powershellLiteral(unpacked)} -Force`])
      const candidates = [path.join(unpacked, 'payload', 'fbth', 'fbth.js'), path.join(unpacked, 'Freebuff-Thai-Pack', 'payload', 'fbth', 'fbth.js')]
      const updater = candidates.find(p => fs.existsSync(p))
      if (!updater) throw new Error('ไม่พบ payload/fbth/fbth.js ใน Language Pack')
      await runFile(nodeRunner(), [updater, 'install'])
      progress('ติดตั้ง Mod ภาษาไทยให้แอปหลักและโคลนสำเร็จ', 'success')
    } else {
      progress('Release ไม่มี Language Pack จึงใช้ Mod ภาษาไทยที่มากับ Manager', 'info')
      await runFbth('install')
      progress('ซิงก์ Mod ภาษาไทยที่มากับ Manager สำเร็จ', 'success')
    }

    if (found.manager && newer(found.managerVersion, app.getVersion())) {
      progress(`กำลังดาวน์โหลดและตรวจ SHA-256 ของ Manager ${found.managerVersion}`)
      const installer = path.join(temp, found.manager.name)
      await downloadVerified(found.manager, installer)
      progress('กำลังเปิดตัวติดตั้ง Manager รุ่นใหม่')
      const child = spawn(installer, [], { detached: true, stdio: 'ignore', windowsHide: true })
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve) })
      child.once('close', () => { try { fs.rmSync(temp, { recursive: true, force: true }) } catch {} })
      child.unref()
      preserveTemp = true
      progress('เปิดตัวติดตั้ง Manager แล้ว', 'success')
      setTimeout(() => app.quit(), 800)
      return { message: `เริ่มติดตั้ง Manager ${found.managerVersion} แล้ว`, restart: true }
    }
    progress('อัปเดตครบทุกส่วนแล้ว', 'success')
    return { message: 'อัปเดตแอปหลัก โคลน และภาษาไทยครบแล้ว', restart: false }
  } catch (error) {
    progress(`อัปเดตไม่สำเร็จ: ${error.message}`, 'error')
    throw error
  } finally {
    if (temp && !preserveTemp) { try { fs.rmSync(temp, { recursive: true, force: true }) } catch (error) { recordLog(`ลบไฟล์อัปเดตชั่วคราวไม่สำเร็จ: ${error.message}`, 'error') } }
    operationActive = false
  }
})
app.whenReady().then(() => { cleanupAbandonedUpdateFolders(); createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() }) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
