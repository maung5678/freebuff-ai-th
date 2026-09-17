const { app, BrowserWindow, ipcMain, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFile } = require('node:child_process')
const crypto = require('node:crypto')
const local = process.env.LOCALAPPDATA || app.getPath('userData')
const cloneRoot = path.join(local, 'Freebuff-Clones')
const cloneConfig = path.join(cloneRoot, 'clones.json')
const mainApp = path.join(local, 'Programs', '@codebufffreebuff-desktop')
const devRoot = path.resolve(__dirname, '..', '..')
const resourcesRoot = app.isPackaged ? process.resourcesPath : devRoot
const fbth = path.join(resourcesRoot, 'fbth', 'fbth.js')
const cloneEngine = path.join(resourcesRoot, 'clone-engine', 'Manage-Freebuff-Clones.ps1')
const UPDATE_REPO = 'maung5678/freebuff-ai-th'
const LANGUAGE_VERSION = '5.0.0'
let cachedRelease = null

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) } catch { return fallback } }
function latestSnapshot(profile) {
  const p = path.join(cloneRoot, profile, 'freebuff-manager-usage.json')
  const s = readJson(p, null)
  if (!s) return null
  return { ...s, stale: Date.now() - Date.parse(s.capturedAt) > 15 * 60 * 1000 }
}
function listClones() {
  const cfg = readJson(cloneConfig, { clones: [] })
  return (cfg.clones || []).map(c => ({ ...c, installed: fs.existsSync(path.join(cloneRoot, c.Name, 'Freebuff.exe')), usage: latestSnapshot(c.Profile) }))
}
function runFile(file, args = [], options = {}) {
  return new Promise((resolve, reject) => execFile(file, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => error ? reject(new Error((stderr || stdout || error.message).trim())) : resolve((stdout + stderr).trim())))
}
function nodeRunner() {
  if (app.isPackaged) return process.execPath
  return process.execPath
}
async function runFbth(command) {
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  return runFile(nodeRunner(), [fbth, command], { env })
}
function createWindow() {
  const win = new BrowserWindow({ width: 1180, height: 760, minWidth: 960, minHeight: 620, backgroundColor: '#090d14', titleBarStyle: 'hiddenInset', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } })
  win.loadFile(path.join(__dirname, 'index.html'))
}
ipcMain.handle('overview', async () => ({ clones: listClones(), mainInstalled: fs.existsSync(path.join(mainApp, 'Freebuff.exe')), version: app.getVersion() }))
ipcMain.handle('run', async (_e, action, payload = {}) => {
  if (action === 'language-install') return { message: await runFbth('install') }
  if (action === 'language-status') return { message: await runFbth('status') }
  if (action === 'language-remove') return { message: await runFbth('uninstall') }
  if (action === 'open-main') { spawn(path.join(mainApp, 'Freebuff.exe'), [], { detached: true, stdio: 'ignore' }).unref(); return { message: 'เปิด Freebuff แล้ว' } }
  const clone = listClones().find(c => c.Name === payload.name)
  if (!clone) throw new Error('ไม่พบบัญชีที่เลือก')
  if (action === 'open-clone') {
    const cloneDir = path.join(cloneRoot, clone.Name)
    const profileDir = path.join(cloneRoot, clone.Profile)
    const exe = path.join(cloneDir, 'Freebuff.exe')
    const env = {
      ...process.env,
      FREEBUFF_CLONE_DISABLE_UPDATER: '1',
      FREEBUFF_DESKTOP_STATE_PATH: path.join(profileDir, 'desktop-state.json'),
    }
    // ต้องตรงกับ Launch <clone>.cmd ของ clone engine ทุกค่า มิฉะนั้น Electron อาจใช้บัญชีหลัก
    spawn(exe, [`--user-data-dir=${profileDir}`], { cwd: cloneDir, env, detached: true, stdio: 'ignore', windowsHide: false }).unref()
    return { message: `เปิด ${clone.Name} แล้ว` }
  }
  if (action === 'rebuild-clones') {
    if (!fs.existsSync(cloneEngine)) throw new Error('ไม่พบ clone engine ในแพ็กเกจ')
    const message = await runFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', cloneEngine, '--rebuild-all'])
    await runFbth('install')
    return { message }
  }
  throw new Error('คำสั่งไม่รองรับ')
})
async function latestRelease() {
  const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Freebuff-Manager' } })
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
  const response = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Freebuff-Manager' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`ดาวน์โหลดไม่สำเร็จ (${response.status})`)
  const data = Buffer.from(await response.arrayBuffer())
  const actual = crypto.createHash('sha256').update(data).digest('hex').toLowerCase()
  const expected = String(asset.digest || '').replace(/^sha256:/i, '').toLowerCase()
  if (!expected) throw new Error('GitHub Release ไม่มี SHA-256 digest จึงยกเลิกเพื่อความปลอดภัย')
  if (actual !== expected) throw new Error('SHA-256 ไม่ตรงกับ GitHub Release จึงยกเลิกการติดตั้ง')
  fs.writeFileSync(destination, data)
}
ipcMain.handle('check-updates', async () => {
  const release = await latestRelease(), found = classifyAssets(release)
  return { repository: UPDATE_REPO, notes: release.body || '',
    manager: { current: app.getVersion(), latest: found.managerVersion, available: !!found.manager && newer(found.managerVersion, app.getVersion()) },
    language: { current: LANGUAGE_VERSION, latest: found.languageVersion, available: !!found.language && newer(found.languageVersion, LANGUAGE_VERSION) } }
})
ipcMain.handle('install-update', async (_e, kind) => {
  const release = cachedRelease || await latestRelease(), found = classifyAssets(release)
  const temp = fs.mkdtempSync(path.join(app.getPath('temp'), 'freebuff-manager-update-'))
  if (kind === 'language') {
    const zip = path.join(temp, found.language?.name || 'language.zip')
    await downloadVerified(found.language, zip)
    const unpacked = path.join(temp, 'language')
    await runFile('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force', zip, unpacked])
    const candidates = [path.join(unpacked, 'payload', 'fbth', 'fbth.js'), path.join(unpacked, 'Freebuff-Thai-Pack', 'payload', 'fbth', 'fbth.js')]
    const updater = candidates.find(p => fs.existsSync(p))
    if (!updater) throw new Error('ไม่พบ payload/fbth/fbth.js ใน Language Pack')
    const message = await runFile(process.execPath, [updater, 'install'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
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
