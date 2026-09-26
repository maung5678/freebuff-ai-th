// Run with manager-app/node_modules/.bin/electron.cmd dev/selftest-manager.cjs
// Real Electron renderer + IPC + filesystem; clone builder is controlled for fault injection.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const vm = require('node:vm'), assert = require('node:assert/strict'), cp = require('node:child_process')
process.noAsar = true
const { createRequire } = require('node:module')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-manager-selftest-'))
const clones = path.join(root, 'Freebuff-Clones'), config = path.join(clones, 'clones.json')
const resources = path.join(root, 'resources'), source = path.resolve(__dirname, '../manager-app/src/main.cjs')
fs.mkdirSync(path.join(resources, 'clone-engine'), { recursive: true })
fs.writeFileSync(path.join(resources, 'clone-engine/Manage-Freebuff-Clones.ps1'), '# test builder')
app.setPath('userData', path.join(root, 'userData'))
const handlers = new Map(), errors = [], built = []
let failBuild = false, realBuild = false, win, probe
function fixture(name, profile = true) {
  const dir = path.join(clones, name)
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Freebuff.exe'), 'fixture')
  fs.writeFileSync(path.join(dir, 'resources/app.asar'), `original:${name}`)
  fs.writeFileSync(path.join(clones, `${name}.lnk`), `shortcut:${name}`)
  if (profile) { fs.mkdirSync(path.join(clones, `${name} Profile`), { recursive: true }); fs.writeFileSync(path.join(clones, `${name} Profile/session.txt`), 'keep-session') }
  return { Name: name, Profile: `${name} Profile`, IconLetter: name.slice(-1), Id: 'freebuff-clone-a' }
}
const initial = [fixture('Freebuff B'), fixture('Freebuff A', false), fixture('Freebuff C')]
fs.writeFileSync(config, JSON.stringify({ clones: initial }))
const wait = ms => new Promise(r => setTimeout(r, ms))
async function until(fn) { for (let i = 0; i < 180; i++) { if (await fn()) return; await wait(100) } throw new Error('Timed out waiting for UI') }
let passed = 0
function ok(value, label) { assert.ok(value, label); console.log(`PASS ${++passed}: ${label}`) }
const invoke = (action, payload) => handlers.get('run')({}, action, payload)
app.whenReady().then(async () => {
  const realRequire = createRequire(source)
  class TestWindow extends BrowserWindow { constructor(options) { super({ ...options, show: false }); win = this; this.webContents.on('console-message', event => { if (event.level === 'error' || event.level === 3) errors.push(event.message) }) } }
  const fakeApp = { isPackaged: true, getPath: key => key === 'temp' ? root : path.join(root, 'userData'), getVersion: () => '0.2.8', whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} }
  const processes = { ...cp, execFileSync: () => '0.0.147', execFile(file, args, options, callback) {
    if (args.includes('-File')) {
      if (realBuild) return cp.execFile(file, [...args, '--isolated'], options, callback)
      const index = args.indexOf('--clone-name'), name = args[index + 1]
      assert.ok(index >= 0, 'individual actions must select exactly one clone')
      built.push(name)
      setTimeout(() => {
        if (failBuild) { fs.mkdirSync(path.join(clones, name), { recursive: true }); fs.writeFileSync(path.join(clones, name, 'partial'), 'partial'); callback(new Error('injected build failure'), '', 'injected build failure'); return }
        fixture(name, false); callback(null, 'Built 1/1 clones.', '')
      }, 300)
      return
    }
    return cp.execFile(file, args, options, callback)
  } }
  const restrictedFs = { ...fs, readdirSync(p, ...args) { if (String(p).startsWith('D:\\This PC')) return []; return fs.readdirSync(p, ...args) } }
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), {
    require: id => id === 'electron' ? { app: fakeApp, BrowserWindow: TestWindow, ipcMain: { handle(name, handler) { handlers.set(name, handler); ipcMain.handle(name, handler) } }, shell: {} } : id === 'node:child_process' ? processes : id === 'node:fs' ? restrictedFs : realRequire(id),
    __dirname: path.dirname(source), process: { env: { ...process.env, LOCALAPPDATA: root }, resourcesPath: resources, platform: 'win32' },
    console, setTimeout, Buffer, fetch: async () => { throw new Error('offline test') }
  }, { filename: source })
  await until(() => win && !win.webContents.isLoading())
  const js = code => win.webContents.executeJavaScript(code, true)
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
  await until(() => js('document.querySelectorAll("[data-rename]").length === 3'))
  ok(await js('document.querySelector("[data-rename]").dataset.rename === "Freebuff A"'), 'natural name order')
  await click('[data-rename="Freebuff B"]')
  ok(await js('document.querySelector("#clone-dialog").open'), 'rename opens real Electron dialog without prompt()')
  await js('document.querySelector("#clone-cancel").click()')
  ok(fs.existsSync(path.join(clones, 'Freebuff B')), 'cancel keeps clone')
  await click('[data-rename="Freebuff B"]')
  await js('document.querySelector("#clone-name").value="../escape"; document.querySelector("#clone-submit").click()')
  await until(() => js('document.querySelector("#clone-error").textContent.length > 0'))
  ok(await js('document.querySelector("#clone-dialog").open'), 'invalid name stays in dialog with error')
  await click('#clone-cancel')
  await assert.rejects(invoke('rename-clone', { oldName: 'Freebuff B', name: 'Freebuff C' }), /มีชื่อนี้/)
  ok(fs.existsSync(path.join(clones, 'Freebuff B')), 'duplicate name cannot overwrite another clone')
  await click('[data-rename="Freebuff B"]')
  await js('document.querySelector("#clone-name").value="Freebuff Z"; document.querySelector("#clone-submit").click()')
  await until(() => js('!document.querySelector("#clone-dialog").open'))
  ok(!fs.existsSync(path.join(clones, 'Freebuff B')) && fs.existsSync(path.join(clones, 'Freebuff Z')), 'rename updates real folders through renderer and IPC')
  ok(fs.readFileSync(path.join(clones, 'Freebuff Z Profile/session.txt'), 'utf8') === 'keep-session', 'rename preserves session')
  ok(built.length === 1 && built[0] === 'Freebuff Z', 'rename rebuilds only requested clone')
  await click('[data-delete="Freebuff A"]'); await click('#clone-cancel')
  ok(fs.existsSync(path.join(clones, 'Freebuff A')), 'delete cancel keeps files')
  await click('[data-delete="Freebuff A"]'); await click('#clone-submit')
  await until(() => js('!document.querySelector("#clone-dialog").open'))
  ok(!fs.existsSync(path.join(clones, 'Freebuff A')), 'delete works without profile folder')
  const before = fs.readFileSync(path.join(clones, 'Freebuff C/resources/app.asar'), 'utf8')
  failBuild = true
  await assert.rejects(invoke('rename-clone', { oldName: 'Freebuff C', name: 'Freebuff F' }), /injected/)
  ok(fs.readFileSync(path.join(clones, 'Freebuff C/resources/app.asar'), 'utf8') === before && !fs.existsSync(path.join(clones, 'Freebuff F')), 'failed rebuild restores original app exactly')
  ok(fs.readFileSync(path.join(clones, 'Freebuff C Profile/session.txt'), 'utf8') === 'keep-session', 'failed rename restores profile')
  ok(fs.readFileSync(path.join(clones, 'Freebuff C.lnk'), 'utf8') === 'shortcut:Freebuff C', 'failed rename restores shortcut')
  failBuild = false
  const job = invoke('rename-clone', { oldName: 'Freebuff C', name: 'Freebuff Y' })
  await assert.rejects(invoke('delete-clone-files', { name: 'Freebuff Z' }), /กำลังทำงาน/)
  await job; ok(true, 'concurrent mutation blocked and lock released')
  const exe = path.join(clones, 'Freebuff Y/Freebuff.exe')
  fs.copyFileSync(path.join(process.env.SystemRoot, 'System32/ping.exe'), exe)
  probe = cp.spawn(exe, ['-t', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' })
  await wait(500)
  await assert.rejects(invoke('delete-clone-files', { name: 'Freebuff Y' }), /กรุณาปิด Freebuff Y/)
  ok(fs.existsSync(exe), 'running target is blocked without deleting files')
  await invoke('delete-clone-files', { name: 'Freebuff Z' })
  ok(!fs.existsSync(path.join(clones, 'Freebuff Z')), 'another running clone does not block deletion')
  probe.kill(); await wait(400)
  await invoke('delete-clone-files', { name: 'Freebuff Y' })
  ok(JSON.parse(fs.readFileSync(config, 'utf8')).clones.length === 0, 'all fixture registrations removed')
  ok(!errors.some(e => /prompt|TypeError|ReferenceError/.test(e)), 'no renderer runtime errors')
  if (process.env.FBTH_REAL_CLONE_TEST === '1') {
    realBuild = true
    fs.copyFileSync(path.resolve(__dirname, '../clone-engine/Manage-Freebuff-Clones.ps1'), path.join(resources, 'clone-engine/Manage-Freebuff-Clones.ps1'))
    await invoke('add-clone', { name: 'Freebuff T' })
    ok(fs.existsSync(path.join(clones, 'Freebuff T/resources/app.asar')), 'real engine creates selected clone in sandbox')
    fs.mkdirSync(path.join(clones, 'Freebuff T Profile'), { recursive: true })
    fs.writeFileSync(path.join(clones, 'Freebuff T Profile/session.txt'), 'real-engine-session')
    await invoke('rename-clone', { oldName: 'Freebuff T', name: 'Freebuff U' })
    ok(fs.readFileSync(path.join(clones, 'Freebuff U Profile/session.txt'), 'utf8') === 'real-engine-session', 'real engine rename preserves profile')
    await invoke('delete-clone-files', { name: 'Freebuff U' })
    ok(!fs.existsSync(path.join(clones, 'Freebuff U')) && !fs.existsSync(path.join(clones, 'Freebuff U Profile')), 'real clone and profile removed through Manager')
  }
  console.log(`PASS ${passed}/${passed}; fixture ${root}`)
}).then(() => { win?.destroy(); app.exit(0) }).catch(error => { console.error(error); probe?.kill(); win?.destroy(); app.exit(1) })
