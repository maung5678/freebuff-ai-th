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
    document.querySelectorAll('[data-rename]').forEach(b => b.onclick = async () => { const oldName = b.dataset.rename, name = prompt('ชื่อใหม่ (ขึ้นต้นด้วย Freebuff)', oldName); if (name?.trim() && name.trim() !== oldName) await run('rename-clone', { oldName, name: name.trim() }) })
    document.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => { const name = b.dataset.delete; if (confirm(`ลบแอปโคลนและโปรไฟล์ของ ${name} ถาวร? ข้อมูลบัญชีและการเข้าสู่ระบบของโคลนนี้จะถูกลบ`)) await run('delete-clone-files', { name }) })
  } catch (e) { await manager.recordError(e.message) }
}
async function run(action, payload) { try { const r = await manager.run(action, payload); if (r.message && !r.silent) { activity.push({ at: new Date().toLocaleString(), level: 'info', message: r.message }); renderLog(); toast(r.message.split('\n')[0]) } await load() } catch (e) { await manager.recordError(e.message); toast(e.message) } }
function setBusy(value, message) { busy = value; const hasUpdates = updateState && (updateState.desktop.available || updateState.language.available || updateState.manager.available || updateState.syncClones); $('#update-all').disabled = value || !hasUpdates; $('#check-update').disabled = value; $('#add-clone').disabled = value; if (message) toast(message) }
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
$('#add-clone').onclick = async () => { const input = $('#new-clone-name'), name = input.value.trim(); if (!name) { input.focus(); return } await run('add-clone', { name }); input.value = '' }
$('#new-clone-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('#add-clone').click() })
$('#activity-button').onclick = async () => { activity = await manager.activityLog(); renderLog(); if (!$('#log').open) $('#log').show() }
$('#close-log').onclick = () => $('#log').close()
$('#copy-log').onclick = async () => { await navigator.clipboard.writeText($('#log-text').textContent); toast('คัดลอก Log แล้ว') }
$('#clear-log').onclick = () => { activity = []; renderLog() }
manager.onActivityLog(entry => { activity.push(entry); if (activity.length > 300) activity.shift(); renderLog() })
load(); checkUpdates(); setInterval(load, 60000)
