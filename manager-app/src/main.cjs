const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
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
const fbth = path.join(resourcesRoot, 'fbth', 'fbth.js')
const cloneEngine = path.join(resourcesRoot, 'clone-engine', 'Manage-Freebuff-Clones.ps1')
const UPDATE_REPO = 'maung5678/freebuff-ai-th'
const LANGUAGE_VERSION = '5.0.0'
let cachedRelease = null
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
  const entry = { at: new Date().toLocaleString(), level, message: String(message || '').trim() }
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
  return [...clones.values()].map(c => ({ ...c, installed: fs.existsSync(path.join(c.AppRoot || cloneRoot, c.Name, 'resources', 'app.asar')) || fs.existsSync(path.join(c.AppRoot || cloneRoot, c.Name, 'Freebuff.exe')), usage: latestSnapshot(c.Profile || `${c.Name} Profile`) }))
}
function runFile(file, args = [], options = {}) {
  const label = `${path.basename(file)} ${args.join(' ')}`
  recordLog(`เริ่ม: ${label}`)
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
    const output = (stdout + stderr).trim()
    if (error) { const reason = (stderr || stdout || error.message).trim(); recordLog(`ผิดพลาด: ${label}\n${reason}`, 'error'); reject(new Error(reason)) }
    else { recordLog(`สำเร็จ: ${label}${output ? `\n${output}` : ''}`); resolve(output) }
  }))
}
function nodeRunner() {
  const bun = path.join(mainApp, 'resources', 'bun', 'bun.exe')
  if (fs.existsSync(bun)) return bun
  try { return require('node:child_process').execFileSync('where.exe', ['node.exe'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim() } catch {}
  throw new Error('ไม่พบ Node.js หรือ Bun สำหรับเรียกตัวแปลภาษาไทย')
}
function powershellLiteral(value) { return `'${String(value).replace(/'/g, "''")}'` }
async function runFbth(command) {
  return runFile(nodeRunner(), [fbth, command])
}
function createWindow() {
  const win = new BrowserWindow({ width: 1180, height: 760, minWidth: 960, minHeight: 620, backgroundColor: '#090d14', titleBarStyle: 'hiddenInset', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
  win.loadFile(path.join(__dirname, 'index.html'))
}
ipcMain.handle('overview', async () => ({ clones: listClones(), mainInstalled: fs.existsSync(path.join(mainApp, 'Freebuff.exe')), mainVersion: fileVersion(path.join(mainApp, 'Freebuff.exe')), version: app.getVersion() }))
ipcMain.handle('activity-log', async () => activityLog)
ipcMain.handle('record-error', async (_e, message) => { recordLog(message, 'error'); return true })
ipcMain.handle('run', async (_e, action, payload = {}) => {
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
    const appRootPath = path.resolve(base) + path.sep, profileRootPath = path.resolve(profileRoot) + path.sep
    const targets = [path.resolve(base, match.Name), path.resolve(profileRoot, match.Profile || `${match.Name} Profile`)]
    if (!targets[0].startsWith(appRootPath) || targets[0] === path.resolve(base) || !targets[1].startsWith(profileRootPath) || targets[1] === path.resolve(profileRoot)) throw new Error('เส้นทางไม่ปลอดภัย จึงยกเลิกการลบ')
    const appExe = path.join(targets[0], 'Freebuff.exe')
    const profileState = path.join(targets[1], 'desktop-state.json')
    const confirmedApp = fs.existsSync(path.join(targets[0], 'resources', 'app.asar')) || fs.existsSync(appExe)
    const confirmedProfile = fs.existsSync(profileState) || fs.existsSync(path.join(targets[1], 'browser'))
    if (!confirmedApp || !confirmedProfile) throw new Error('ตรวจไม่พบคู่แอปและโปรไฟล์ที่คาดไว้ จึงไม่ลบไฟล์')
    await runFile('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='Freebuff.exe'\" | Where-Object { $_.ExecutablePath -like '*Freebuff-Clones*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"])
    if (match.AppRoot === legacyCloneRoot) throw new Error('ลบไฟล์จากโครงการเดิมไม่ได้จาก Manager รุ่นนี้ กรุณาจัดการผ่านตัวเดิม')
    fs.rmSync(targets[0], { recursive: true, force: true })
    fs.rmSync(targets[1], { recursive: true, force: true })
    cfg.clones = (cfg.clones || []).filter(c => c?.Name !== payload.name)
    fs.writeFileSync(cloneConfig, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
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
    const exe = fs.existsSync(cloneExe) ? cloneExe : path.join(mainApp, 'Freebuff.exe')
    if (!fs.existsSync(exe)) throw new Error(`ไม่พบไฟล์แอปโคลนหรือแอปหลักที่ใช้เปิดได้: ${cloneExe}`)
    const env = {
      ...process.env,
      FREEBUFF_CLONE_DISABLE_UPDATER: '1',
      FREEBUFF_DESKTOP_STATE_PATH: path.join(profileDir, 'desktop-state.json'),
    }
    // ต้องตรงกับ Launch <clone>.cmd ของ clone engine ทุกค่า มิฉะนั้น Electron อาจใช้บัญชีหลัก
    fs.mkdirSync(profileDir, { recursive: true })
    const child = spawn(exe, [`--user-data-dir=${profileDir}`], { cwd: fs.existsSync(cloneDir) ? cloneDir : mainApp, env, detached: true, stdio: 'ignore', windowsHide: false })
    child.on('error', error => recordLog(`เปิดโคลน ${clone.Name} ไม่สำเร็จ: ${error.message}`, 'error')); child.unref()
    recordLog(`เปิดโคลน ${clone.Name} ด้วยโปรไฟล์ ${profileDir}`)
    return { message: `เปิด ${clone.Name} แล้ว`, silent: true }
  }
  if (action === 'rebuild-clones') {
    if (!fs.existsSync(cloneEngine)) throw new Error('ไม่พบ clone engine ในแพ็กเกจ')
    await runFile('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='Freebuff.exe'\" | Where-Object { $_.ExecutablePath -like '*Freebuff-Clones*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"])
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
    const used = new Set(listClones().map(c => c.IconLetter).filter(Boolean))
    const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(x => !used.has(x))
    if (!letter) throw new Error('ไม่มีตัวอักษรไอคอนว่าง')
    const cfg = readJson(cloneConfig, null) || readJson(cloneProjectConfig, null) || readJson(legacyCloneConfig, { clones: [] })
    const clone = { Name: name, Id: `freebuff-clone-${letter.toLowerCase()}`, Profile: `${name} Profile`, Partition: `persist:clone-${letter.toLowerCase()}`, IconLetter: letter }
    cfg.clones = [...(cfg.clones || []), clone]
    const existing = new Set(cfg.clones.map(c => c.Name.toLocaleLowerCase()))
    cfg.clones = [...cfg.clones, ...listClones().filter(c => c.AppRoot === legacyCloneRoot && !existing.has(c.Name.toLocaleLowerCase())).map(c => ({ ...c, AppRoot: legacyCloneRoot, ProfileRoot: legacyCloneRoot }))]
    persistCloneConfig(cfg)
    try {
      const message = await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cloneEngine, '--rebuild-all', '--clone-only', '--clone-root', cloneRoot])
      return { message }
    } catch (error) {
      cfg.clones = cfg.clones.filter(c => c.Name !== name); persistCloneConfig(cfg); throw error
    }
  }
  if (action === 'rename-clone') {
    const oldName = String(payload.oldName || ''), name = String(payload.name || '').trim()
    if (!/^Freebuff\s+[A-Za-z0-9][A-Za-z0-9 _-]{0,30}$/.test(name)) throw new Error('ชื่อควรขึ้นต้นด้วย Freebuff และใช้ตัวอักษร/ตัวเลขเท่านั้น')
    if (listClones().some(c => c.Name.toLocaleLowerCase() === name.toLocaleLowerCase() && c.Name !== oldName)) throw new Error('มีชื่อนี้อยู่แล้ว')
    const cfg = readJson(cloneConfig, null) || readJson(cloneProjectConfig, null) || readJson(legacyCloneConfig, { clones: [] }), c = (cfg.clones || []).find(x => x.Name === oldName)
    if (!c) {
      const found = listClones().find(x => x.Name === oldName)
      if (!found) throw new Error('ไม่พบรายการโคลนที่ต้องการเปลี่ยนชื่อ')
      throw new Error('โคลนจากตำแหน่งเดิมยังเปลี่ยนชื่อไม่ได้อย่างปลอดภัย ให้กดอัปเดตโคลนก่อน')
    }
    if (c.Discovered) throw new Error('โคลนนี้เพิ่งค้นพบจากโฟลเดอร์ ให้กดอัปเดตโคลนทั้งหมดก่อน แล้วค่อยเปลี่ยนชื่อ')
    if (c.AppRoot === legacyCloneRoot) throw new Error('โคลนจากตำแหน่งเดิมยังเปลี่ยนชื่อไม่ได้อย่างปลอดภัย กรุณาอัปเดตโคลนก่อน')
    await runFile('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='Freebuff.exe'\" | Where-Object { $_.ExecutablePath -like '*Freebuff-Clones*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"])
    const root = c.AppRoot || cloneRoot
    const oldProfile = path.join(c.ProfileRoot || root, c.Profile || `${oldName} Profile`), newProfileName = `${name} Profile`, newProfile = path.join(c.ProfileRoot || root, newProfileName)
    if (fs.existsSync(newProfile)) throw new Error('มีโฟลเดอร์โปรไฟล์ปลายทางอยู่แล้ว จึงไม่เปลี่ยนชื่อเพื่อป้องกันข้อมูลทับกัน')
    const oldDir = path.join(root, c.Name), newDir = path.join(root, name)
    if (fs.existsSync(newDir)) throw new Error('มีโฟลเดอร์แอปปลายทางอยู่แล้ว จึงไม่เปลี่ยนชื่อเพื่อป้องกันข้อมูลทับกัน')
    c.Name = name; c.Profile = newProfileName
    persistCloneConfig(cfg)
    try {
      if (fs.existsSync(oldProfile)) fs.renameSync(oldProfile, newProfile)
      if (fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir)
      return { message: `เปลี่ยนชื่อเป็น ${name} แล้ว โปรไฟล์เดิมถูกเก็บไว้` }
    } catch (error) {
      c.Name = oldName; c.Profile = path.basename(oldProfile)
      try { persistCloneConfig(cfg) } catch {}
      throw error
    }
  }
  throw new Error('คำสั่งไม่รองรับ')
})
async function updateFetch(url, options = {}) {
  try { return await fetch(url, { ...options, ...(updateDispatcher ? { dispatcher: updateDispatcher } : {}) }) }
  catch (error) {
    const causeCode = error?.cause?.code || error?.cause?.cause?.code
    const detail = causeCode ? ` (${causeCode})` : ''
    throw new Error(`เชื่อมต่อ GitHub ไม่สำเร็จ${detail}: ตรวจสอบอินเทอร์เน็ตหรือ Proxy แล้วลองใหม่`, { cause: error })
  }
}
async function latestRelease() {
  const response = await updateFetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Freebuff-Manager' } })
  if (!response.ok) throw new Error(`GitHub ตอบกลับ ${response.status}`)
  const release = await response.json()
  cachedRelease = release
  return release
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
ipcMain.handle('check-updates', async () => {
  recordLog('กำลังตรวจสอบเวอร์ชันและอัปเดต')
  const release = await latestRelease(), found = classifyAssets(release)
  recordLog(`ตรวจเวอร์ชันแล้ว: Manager ${found.managerVersion}, ภาษาไทย ${found.languageVersion}`)
  return { repository: UPDATE_REPO, notes: release.body || '',
    manager: { current: app.getVersion(), latest: found.managerVersion, available: !!found.manager && newer(found.managerVersion, app.getVersion()) },
    language: { current: LANGUAGE_VERSION, latest: found.languageVersion, available: !!found.language && newer(found.languageVersion, LANGUAGE_VERSION) } }
})
ipcMain.handle('install-update', async (_e, kind) => {
  recordLog(`เริ่มอัปเดต ${kind === 'language' ? 'ภาษาไทย' : 'Manager'}`)
  const release = cachedRelease || await latestRelease(), found = classifyAssets(release)
  const temp = fs.mkdtempSync(path.join(app.getPath('temp'), 'freebuff-manager-update-'))
  if (kind === 'language') {
    const zip = path.join(temp, found.language?.name || 'language.zip')
    await downloadVerified(found.language, zip)
    const unpacked = path.join(temp, 'language')
    const expandCommand = `Expand-Archive -LiteralPath ${powershellLiteral(zip)} -DestinationPath ${powershellLiteral(unpacked)} -Force`
    await runFile('powershell.exe', ['-NoProfile', '-Command', expandCommand])
    const candidates = [path.join(unpacked, 'payload', 'fbth', 'fbth.js'), path.join(unpacked, 'Freebuff-Thai-Pack', 'payload', 'fbth', 'fbth.js')]
    const updater = candidates.find(p => fs.existsSync(p))
    if (!updater) throw new Error('ไม่พบ payload/fbth/fbth.js ใน Language Pack')
    const message = await runFile(nodeRunner(), [updater, 'install'])
    return { message: 'อัปเดต Mod ภาษาไทยสำเร็จ\n\n' + message, restart: false }
  }
  if (kind === 'manager') {
    const installer = path.join(temp, found.manager?.name || 'Freebuff-Manager-Setup.exe')
    await downloadVerified(found.manager, installer)
    spawn(installer, [], { detached: true, stdio: 'ignore' }).unref()
    setTimeout(() => app.quit(), 800)
    return { message: 'กำลังเปิดตัวติดตั้ง Manager รุ่นใหม่…', restart: true }
  }
  throw new Error('ประเภทอัปเดตไม่ถูกต้อง')
})
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() }) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
