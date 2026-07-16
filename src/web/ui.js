export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

const CSS = `
:root{color-scheme:light;--ink:#152033;--muted:#667085;--line:#d9e0ea;--paper:#fff;--soft:#f3f6fb;
--brand:#3157d5;--brand-dark:#203d9d;--good:#157f58;--warn:#a65b09;--bad:#b42318;--shadow:0 12px 32px #203d9d12}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f7f9fc;color:var(--ink);
font-family:Inter,"Noto Sans TC","Segoe UI",system-ui,sans-serif;line-height:1.55}
a{color:var(--brand);text-underline-offset:3px}button,input,select{font:inherit}button{cursor:pointer}
.skip{position:absolute;left:-9999px;top:.5rem;background:var(--ink);color:#fff;padding:.65rem 1rem;z-index:20}
.skip:focus{left:.5rem}.shell{width:min(1180px,calc(100% - 2rem));margin:auto}
.topbar{background:#101b31;color:#fff;position:sticky;top:0;z-index:10;box-shadow:0 3px 14px #101b3124}
.topbar .shell{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:68px}
.brand{display:flex;gap:.65rem;align-items:center;font-weight:800;color:#fff;text-decoration:none;letter-spacing:.01em}
.brand-mark{display:grid;place-items:center;width:34px;height:34px;border-radius:12px;background:linear-gradient(135deg,#7da0ff,#3157d5)}
nav{display:flex;gap:.25rem;flex-wrap:wrap}nav a{color:#dce5ff;text-decoration:none;padding:.5rem .7rem;border-radius:9px}
nav a:hover,nav a[aria-current=page]{background:#ffffff18;color:#fff}
main{padding:2rem 0 4rem}.hero{padding:2.2rem;border-radius:24px;background:linear-gradient(130deg,#172b59,#3157d5);color:#fff;
box-shadow:var(--shadow);margin-bottom:1.5rem}.eyebrow{margin:0 0 .35rem;text-transform:uppercase;letter-spacing:.12em;font-size:.75rem;font-weight:800;opacity:.76}
h1,h2,h3{line-height:1.2}h1{font-size:clamp(1.8rem,4vw,2.8rem);margin:.25rem 0 .75rem}h2{font-size:1.28rem;margin:0 0 1rem}
.hero p{max-width:700px;margin:.4rem 0;color:#e7ecff}.grid{display:grid;gap:1rem}.stats{grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:1.5rem}
.card{background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:1.25rem;box-shadow:var(--shadow)}
.stat strong{display:block;font-size:1.85rem}.stat span,.muted{color:var(--muted)}
.section-head{display:flex;justify-content:space-between;align-items:start;gap:1rem;margin-bottom:1rem}.section-head p{margin:.2rem 0;color:var(--muted)}
.two-col{grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr)}.source-list{display:grid;gap:.85rem}
.source-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;padding:1rem;border:1px solid var(--line);border-radius:14px;background:#fff}
.source-card h3{margin:0 0 .3rem;font-size:1rem}.meta{display:flex;flex-wrap:wrap;gap:.4rem .8rem;color:var(--muted);font-size:.88rem}
.actions{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;justify-content:flex-end}.pill{display:inline-flex;align-items:center;padding:.2rem .55rem;border-radius:999px;font-size:.78rem;font-weight:700;background:#eef2f8;color:#344054}
.pill.good{background:#e8f7f0;color:var(--good)}.pill.bad{background:#feeceb;color:var(--bad)}.pill.warn{background:#fff4e5;color:var(--warn)}
.btn{border:1px solid transparent;border-radius:10px;padding:.62rem .9rem;font-weight:750;background:var(--brand);color:#fff}
.btn:hover{background:var(--brand-dark)}.btn.secondary{background:#fff;color:var(--ink);border-color:var(--line)}.btn.secondary:hover{background:var(--soft)}
.btn.danger{background:#fff;color:var(--bad);border-color:#f2b8b5}.btn[disabled]{opacity:.55;cursor:not-allowed}
label{display:block;font-weight:700;margin-bottom:.35rem}.field{margin-bottom:1rem}.hint{font-size:.85rem;color:var(--muted);margin:.35rem 0 0}
input,select{width:100%;padding:.74rem .8rem;border:1px solid #b8c2d1;border-radius:10px;background:#fff;color:var(--ink)}
input:focus,select:focus,button:focus-visible,a:focus-visible{outline:3px solid #82a2ff;outline-offset:2px}
.inline-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.65rem;align-items:end}
.preview{margin-top:1rem;border:1px solid #9eb1ea;background:#f7f9ff;border-radius:14px;padding:1rem}.preview[hidden]{display:none}
.preview dl{display:grid;grid-template-columns:max-content 1fr;gap:.35rem .8rem;margin:.75rem 0}.preview dt{color:var(--muted)}.preview dd{margin:0;overflow-wrap:anywhere}
.notice{border-left:4px solid var(--brand);background:#eef3ff;padding:.75rem 1rem;border-radius:8px;margin:.75rem 0}.notice.warn{border-color:var(--warn);background:#fff8ed}
.status{min-height:1.5rem;margin:.6rem 0;color:var(--muted)}.status.error{color:var(--bad)}.status.success{color:var(--good)}
.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:14px;background:#fff}table{border-collapse:collapse;width:100%;min-width:680px}
th,td{text-align:left;padding:.7rem .8rem;border-bottom:1px solid var(--line);vertical-align:top}th{background:#f3f6fb;font-size:.84rem}tr:last-child td{border-bottom:0}
dialog{width:min(620px,calc(100% - 2rem));border:0;border-radius:20px;padding:0;box-shadow:0 24px 70px #101b3155}dialog::backdrop{background:#101b31a8}
.dialog-body{padding:1.5rem}.dialog-actions{display:flex;justify-content:flex-end;gap:.6rem;margin-top:1.25rem}
footer{border-top:1px solid var(--line);padding:1.25rem 0 2rem;color:var(--muted);font-size:.85rem}
@media(max-width:820px){.stats{grid-template-columns:repeat(2,1fr)}.two-col{grid-template-columns:1fr}.topbar .shell{align-items:flex-start;padding:.8rem 0;flex-direction:column}nav{width:100%;overflow:auto;flex-wrap:nowrap}.source-card{grid-template-columns:1fr}.actions{justify-content:flex-start}}
@media(max-width:520px){.shell{width:min(100% - 1rem,1180px)}main{padding-top:1rem}.hero{padding:1.35rem;border-radius:18px}.stats{grid-template-columns:1fr 1fr}.card{padding:1rem}.inline-form{grid-template-columns:1fr}.inline-form .btn{width:100%}.preview dl{grid-template-columns:1fr}.preview dd{margin-bottom:.35rem}.actions .btn{flex:1}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
`;

function nav(current) {
  const items = [['/', '總覽'], ['/products', '商品'], ['/offers', '可購買'], ['/events', '事件'], ['/sources', '來源管理']];
  return items.map(([href, label]) => `<a href="${href}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`).join('');
}

export function layout({ title, current = '/', body, csrfToken, nonce, onboarding = false, extraScript = '' }) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="csrf-token" content="${esc(csrfToken)}"><title>${esc(title)}｜Beyblade Tracker</title><style>${CSS}</style></head><body>
<a class="skip" href="#main">跳到主要內容</a><header class="topbar"><div class="shell"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">B</span><span>Beyblade Tracker</span></a><nav aria-label="主要導覽">${nav(current)}</nav></div></header>
<main id="main" class="shell">${body}</main><footer><div class="shell">資料只保存在這台電腦。所有庫存狀態都應搭配最後檢查時間判讀。</div></footer>
${onboarding ? onboardingDialog() : ''}<script nonce="${esc(nonce)}">${COMMON_JS}${onboarding ? ONBOARDING_JS : ''}${extraScript}</script></body></html>`;
}

export function table(headers, rows) {
  if (!rows.length) return '<p class="muted">目前沒有資料。</p>';
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function onboardingDialog() {
  return `<dialog id="onboarding" aria-labelledby="onboarding-title"><div class="dialog-body"><p class="eyebrow">首次設定</p><h2 id="onboarding-title">先選擇適合你的使用方式</h2><p class="muted">這些設定之後都能調整，不會阻擋商品追蹤。</p><form id="onboarding-form">
  <div class="field"><label for="language">介面語言</label><select id="language" name="language"><option value="zh-TW">繁體中文</option><option value="ja">日本語</option><option value="en">English</option></select></div>
  <div class="field"><label for="notification">通知方式</label><select id="notification" name="notification"><option value="app">先只保存在 App</option><option value="telegram">Telegram 私人聊天</option><option value="windows">Windows 本機通知</option></select></div>
  <div class="field"><label for="scanFrequency">掃描頻率</label><select id="scanFrequency" name="scanFrequency"><option value="balanced">平衡（建議）</option><option value="frequent">較頻繁</option><option value="gentle">較溫和</option></select></div>
  <div class="field"><label for="dataRetentionDays">歷史資料保存天數</label><input id="dataRetentionDays" name="dataRetentionDays" type="number" min="30" max="3650" value="365"></div>
  <p id="onboarding-status" class="status" role="status" aria-live="polite"></p><div class="dialog-actions"><button class="btn" type="submit">儲存並開始</button></div>
  </form></div></dialog>`;
}

const COMMON_JS = `
const csrf=document.querySelector('meta[name="csrf-token"]')?.content||'';
async function api(path,options={}){const headers={'Content-Type':'application/json','X-CSRF-Token':csrf,...(options.headers||{})};const res=await fetch(path,{...options,headers});let data={};try{data=await res.json()}catch{}if(!res.ok)throw new Error(data.error||'操作失敗，請稍後再試。');return data}
`;

const ONBOARDING_JS = `
const onboarding=document.getElementById('onboarding');if(onboarding){onboarding.showModal();document.getElementById('onboarding-form').addEventListener('submit',async(event)=>{event.preventDefault();const status=document.getElementById('onboarding-status');const data=Object.fromEntries(new FormData(event.currentTarget));status.textContent='正在儲存…';try{await api('/api/settings',{method:'POST',body:JSON.stringify(data)});status.textContent='設定完成。';onboarding.close()}catch(error){status.className='status error';status.textContent=error.message}})}
`;

export function sourcesScript() {
  return `
const form=document.getElementById('add-source-form');const preview=document.getElementById('source-preview');const status=document.getElementById('source-status');let lastPreview=null;
function setStatus(message,type=''){status.className='status '+type;status.textContent=message}
function renderPreview(data){lastPreview=data;preview.hidden=false;const existing=data.existingSite?'<div class="notice warn"><strong>這間商店已存在。</strong> 確認後會把這個頁面加入既有商店，不會建立重複商店。</div>':'';const candidate=data.candidate?'<div class="notice"><strong>'+escapeHtml(data.candidate.title)+'</strong><br>型號：'+escapeHtml(data.candidate.model||'未辨識')+' · 狀態：'+escapeHtml(data.candidate.state)+'</div>':'<div class="notice warn">這一頁尚未顯示可辨識的商品資料；若是既有商店仍可加入種子。</div>';preview.innerHTML=existing+'<h3>加入前預覽</h3><dl><dt>標準網址</dt><dd>'+escapeHtml(data.canonicalUrl)+'</dd><dt>商店網域</dt><dd>'+escapeHtml(data.domain)+'</dd><dt>掃描範圍</dt><dd>只測試這一頁；最多 '+data.resourceBudget.maxDownloadMb+' MB／'+data.resourceBudget.maxSeconds+' 秒</dd><dt>連線結果</dt><dd>'+escapeHtml(data.connection.message)+'</dd></dl>'+candidate+'<div class="actions"><a class="btn secondary" href="#source-list">前往現有商店</a><button id="confirm-source" class="btn" '+(data.canConfirm?'':'disabled')+'>確認加入</button></div>';document.getElementById('confirm-source')?.addEventListener('click',confirmSource)}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
form.addEventListener('submit',async(event)=>{event.preventDefault();const url=document.getElementById('source-url').value;preview.hidden=true;setStatus('正在安全地測試這一頁…');const button=form.querySelector('button');button.disabled=true;try{const data=await api('/api/sources/preview',{method:'POST',body:JSON.stringify({url})});renderPreview(data);setStatus('預覽完成。請確認範圍與結果。','success')}catch(error){setStatus(error.message,'error')}finally{button.disabled=false}});
async function confirmSource(){if(!lastPreview)return;setStatus('正在加入來源…');try{const data=await api('/api/sources',{method:'POST',body:JSON.stringify({url:lastPreview.inputUrl,name:lastPreview.suggestedName,confirmed:true})});setStatus(data.message,'success');setTimeout(()=>location.reload(),500)}catch(error){setStatus(error.message,'error')}}
document.querySelectorAll('[data-source-action]').forEach(button=>button.addEventListener('click',async()=>{const id=button.dataset.sourceId;const action=button.dataset.sourceAction;button.disabled=true;const output=document.getElementById('source-action-status');try{if(action==='test'){output.textContent='正在測試連線與解析…';const data=await api('/api/sources/'+id+'/test',{method:'POST',body:'{}'});output.className='status success';output.textContent='測試成功：辨識到 '+data.count+' 個結果。'}else{const enable=action==='enable';if(!enable&&!confirm('停用後會保留商品、事件與價格歷史。確定要停用嗎？'))return;const data=await api('/api/sources/'+id,{method:'PATCH',body:JSON.stringify({enabled:enable})});output.className='status success';output.textContent=data.message;setTimeout(()=>location.reload(),400)}}catch(error){output.className='status error';output.textContent=error.message}finally{button.disabled=false}}));
`;
}
