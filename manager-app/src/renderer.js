const $ = s => document.querySelector(s)
const toast = text => { const el = $('#toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3500) }
const remaining = u => u?.remaining != null ? (u.limit != null ? `${u.remaining} / ${u.limit}` : `${u.remaining}`) : 'ยังไม่มีข้อมูล'
const reset = u => { if (!u?.resetAt) return 'เปิดแอปเพื่อบันทึกสถานะ'; const ms = Date.parse(u.resetAt) - Date.now(); if (ms <= 0) return 'ถึงเวลารีเซ็ตแล้ว · เปิดแอปเพื่อยืนยัน'; const h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4); return `รีเซ็ตใน ${h} ชม. ${m} นาที` }
let activity = [], updateState = null, busy = false
function renderLog() { const box = $('#log-text'); box.className = 'activity-list'; box.innerHTML = activity.map(x => `<div class="activity-entry ${['running','success','error'].includes(x.level) ? x.level : 'info'}"><time class="time">${esc(x.at)}</time><span class="message">${esc(x.message)}</span></div>`).join('') || '<p class="empty">ยังไม่มีรายการ</p>'; box.scrollTop = box.scrollHeight; $('#activity-summary').textContent = activity.length ? activity.at(-1).message.split('\n')[0] : 'Log'; $('#activity-button').classList.toggle('has-error', activity.some(x => x.level === 'error')) }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]) }
async function load() {
  try {
    const d = await manager.overview(); $('#count').textContent = d.clones.length; $('#version').textContent = `Manager ${d.version}`; $('#main-version').textContent = d.mainVersion || 'ไม่พบแอปหลัก'
    $('#account-list').innerHTML = d.clones.map(c => `<article class="account-row"><div class="avatar">${esc(c.IconLetter || c.Name.slice(-1))}</div><div class="clone-info"><b>${esc(c.Name)}</b><span>${c.installed ? 'พร้อมใช้' : 'ยังไม่พบไฟล์แอป'}${c.Discovered ? ' · พบอัตโนมัติ' : ''} · เหลือ ${esc(remaining(c.usage))}</span><small>${esc(reset(c.usage))}</small></div><div class="row-actions"><button class="icon-button" data-open="${esc(c.Name)}" title="เปิดโคลน" aria-label="เปิดโคลน">↗</button><button class="icon-button" data-rename="${esc(c.Name)}" title="เปลี่ยนชื่อ" aria-label="เปลี่ยนชื่อ">✎</button><button class="icon-button delete" data-delete="${esc(c.Name)}" title="ลบโคลนและโปรไฟล์" aria-label="ลบโคลนและโปรไฟล์">⌫</button></div></article>`).join('') || '<p class="empty">ยังไม่มีโคลน กด ＋ เพื่อเพิ่มโคลนแรก</p>'
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => run('open-clone', { name: b.dataset.open }))
    document.querySelectorAll('[data-rename]').forEach(b => b.onclick = () => openCloneDialog('rename', b.dataset.rename))
    document.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => openCloneDialog('delete', b.dataset.delete))
    setBusy(busy)
  } catch (e) { await manager.recordError(e.message) }
}
async function run(action, payload) { if (busy) return false; setBusy(true); try { const r = await manager.run(action, payload); if (r.message && !r.silent) { toast(r.message.split('\n')[0]) } await load(); return true } catch (e) { toast(e.message); $('#clone-error').textContent = e.message; return false } finally { setBusy(false) } }
function setBusy(value, message) { busy = value; const hasUpdates = updateState && (updateState.desktop.available || updateState.language.available || updateState.manager.available || updateState.syncClones); $('#update-all').disabled = value || !hasUpdates; document.querySelectorAll('#check-update, #add-clone, #open-main, #refresh, .row-actions button, #clone-submit, #clone-cancel').forEach(b => b.disabled = value); if (message) toast(message) }
let cloneAction = null
function openCloneDialog(action, name) {
  if (busy) return
  cloneAction = { action, name }
  $('#clone-title').textContent = action === 'rename' ? `เปลี่ยนชื่อ ${name}` : `ลบ ${name}?`
  $('#clone-description').textContent = action === 'rename' ? 'โปรไฟล์และข้อมูลบัญชีจะย้ายไปใช้ชื่อใหม่' : 'ลบแอปและโปรไฟล์ของโคลนนี้ถาวร รวมข้อมูลการเข้าสู่ระบบ'
  $('#clone-name-field').hidden = action !== 'rename'
  $('#clone-name').value = name
  $('#clone-name').required = action === 'rename'
  $('#clone-error').textContent = ''
  $('#clone-submit').textContent = action === 'rename' ? 'บันทึกชื่อ' : 'ลบโคลน'
  $('#clone-dialog').showModal()
  if (action === 'rename') { $('#clone-name').focus(); $('#clone-name').select() } else $('#clone-cancel').focus()
}
$('#clone-cancel').onclick = () => $('#clone-dialog').close()
$('#clone-dialog').addEventListener('cancel', e => { if (busy) e.preventDefault() })
$('#clone-form').onsubmit = async e => {
  e.preventDefault()
  if (!cloneAction || busy) return
  const { action, name: oldName } = cloneAction, name = $('#clone-name').value.trim()
  if (action === 'rename' && name === oldName) { $('#clone-dialog').close(); return }
  $('#clone-error').textContent = ''
  const ok = await run(action === 'rename' ? 'rename-clone' : 'delete-clone-files', action === 'rename' ? { oldName, name } : { name: oldName })
  if (ok) $('#clone-dialog').close()
}
window.addEventListener('error', e => { manager.recordError(e.message); toast(e.message) })
window.addEventListener('unhandledrejection', e => { const message = e.reason?.message || String(e.reason); manager.recordError(message); toast(message) })
async function checkUpdates() {
  try { toast('กำลังตรวจเวอร์ชันแอปและ Release…'); updateState = await manager.checkUpdates(); const { desktop, language, manager: managerUpdate } = updateState
    $('#desktop-version').textContent = `${desktop.current}${desktop.available ? ` → ${desktop.latest}` : ''}`; $('#language-version').textContent = `${language.current}${language.available ? ` → ${language.latest}` : ''}`; $('#manager-version').textContent = `${managerUpdate.current}${managerUpdate.available ? ` → ${managerUpdate.latest}` : ''}`
    $('#main-update').textContent = desktop.available ? `มีเวอร์ชันใหม่ ${desktop.latest}` : 'เป็นเวอร์ชันล่าสุด'; $('#main-update').classList.toggle('available', desktop.available)
    $('#update-all').disabled = busy || !(desktop.available || language.available || managerUpdate.available || updateState.syncClones); $('#update-all').title = $('#update-all').disabled ? 'ทุกส่วนเป็นเวอร์ชันล่าสุด' : 'อัปเดตแอปหลัก โคลน และภาษาไทย'
    toast($('#update-all').disabled ? 'ทุกส่วนเป็นเวอร์ชันล่าสุด' : 'มีอัปเดตพร้อมติดตั้ง')
  } catch (e) { updateState = null; $('#update-all').disabled = true; await manager.recordError(e.message); toast(e.message) }
}
async function updateAll() { if (busy) return; if (!updateState) { await checkUpdates(); if (!updateState) return } setBusy(true, 'เริ่มอัปเดตทั้งหมด…'); try { const result = await manager.updateAll(); if (result.restart) { updateState.manager.installing = true; toast(result.message); return } activity.push({ at: new Date().toLocaleTimeString(), level: 'success', message: result.message }); renderLog(); await load(); await checkUpdates(); toast('อัปเดตแอปหลัก โคลน และภาษาไทยครบแล้ว') } catch (e) { await manager.recordError(e.message); toast(e.message) } finally { if (!updateState?.manager?.installing) setBusy(false) } }
$('#check-update').onclick = checkUpdates
$('#update-all').onclick = updateAll
$('#refresh').onclick = load
$('#open-main').onclick = () => run('open-main')
$('#add-clone').onclick = async () => { const input = $('#new-clone-name'), name = input.value.trim(); if (!name) { input.focus(); return } if (await run('add-clone', { name })) input.value = '' }
$('#new-clone-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('#add-clone').click() })
$('#activity-button').onclick = async () => { activity = await manager.activityLog(); renderLog(); if (!$('#log').open) $('#log').show() }
$('#close-log').onclick = () => $('#log').close()
$('#copy-log').onclick = async () => { await navigator.clipboard.writeText($('#log-text').textContent); toast('คัดลอก Log แล้ว') }
$('#clear-log').onclick = () => { activity = []; renderLog() }
manager.onActivityLog(entry => { activity.push(entry); if (activity.length > 300) activity.shift(); renderLog() })
load(); checkUpdates(); setInterval(load, 60000)
