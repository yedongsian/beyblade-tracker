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
.language-picker{width:auto;min-width:110px;padding:.38rem .5rem;background:#17233d;color:#fff;border-color:#52617c}
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

function nav(current, t) {
  const items = [
    ['/', t('nav.overview')], ['/products', t('nav.products')], ['/offers', t('nav.offers')],
    ['/events', t('nav.events')], ['/catalog', t('nav.catalog')], ['/watchlist', t('nav.watchlist')], ['/community', t('nav.community')], ['/review', t('nav.review')],
    ['/exclusions', t('nav.exclusions')], ['/sources', t('nav.sources')], ['/settings', t('nav.settings')],
  ];
  return items.map(([href, label]) => `<a href="${href}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`).join('');
}

export function layout({
  title, current = '/', body, csrfToken, nonce, onboarding = false, extraScript = '',
  language = 'zh-TW', t = createTranslator(language),
}) {
  const htmlLanguage = t.locale === 'zh-TW' ? 'zh-Hant' : t.locale;
  return `<!doctype html><html lang="${esc(htmlLanguage)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="csrf-token" content="${esc(csrfToken)}"><title>${esc(title)}｜${esc(t('app.name'))}</title><style>${CSS}</style></head><body>
<a class="skip" href="#main">${esc(t('a11y.skip'))}</a><header class="topbar"><div class="shell"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">B</span><span>${esc(t('app.name'))}</span></a><nav aria-label="${esc(t('a11y.primaryNav'))}">${nav(current, t)}</nav><select id="language-picker" class="language-picker" aria-label="${esc(t('language.label'))}"><option value="zh-TW"${t.locale === 'zh-TW' ? ' selected' : ''}>繁體中文</option><option value="ja"${t.locale === 'ja' ? ' selected' : ''}>日本語</option><option value="en"${t.locale === 'en' ? ' selected' : ''}>English</option></select></div></header>
<main id="main" class="shell">${body}</main><footer><div class="shell">${esc(t('footer.local'))}</div></footer>
${errorDialog()}${onboarding ? onboardingDialog(t) : ''}<script nonce="${esc(nonce)}">${commonJs(t)}${onboarding ? onboardingJs(t) : ''}${extraScript}</script></body></html>`;
}

export function table(headers, rows, t = createTranslator()) {
  if (!rows.length) return `<p class="muted">${esc(t('common.none'))}</p>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function onboardingDialog(t) {
  return `<dialog id="onboarding" aria-labelledby="onboarding-title"><div class="dialog-body"><p class="eyebrow">${esc(t('onboarding.eyebrow'))}</p><h2 id="onboarding-title">${esc(t('onboarding.title'))}</h2><p class="muted">${esc(t('onboarding.intro'))}</p><form id="onboarding-form">
  <div class="field"><label for="language">${esc(t('onboarding.language'))}</label><select id="language" name="language"><option value="zh-TW">繁體中文</option><option value="ja">日本語</option><option value="en">English</option></select></div>
  <div class="field"><label for="notification">${esc(t('onboarding.notification'))}</label><select id="notification" name="notification"><option value="telegram">${esc(t('onboarding.telegram'))}</option><option value="app">${esc(t('onboarding.app'))}</option><option value="windows">${esc(t('onboarding.windows'))}</option></select></div>
  <fieldset id="onboarding-telegram"><legend>${esc(t('settings.telegramTitle'))}</legend><p class="hint">${esc(t('settings.telegramSteps'))} <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">BotFather</a></p><div class="field"><label for="onboarding-token">${esc(t('settings.botToken'))}</label><input id="onboarding-token" name="telegramToken" type="password" autocomplete="off"></div><div class="field"><label for="onboarding-chat">${esc(t('settings.chatId'))}</label><input id="onboarding-chat" name="telegramChatId" autocomplete="off"></div></fieldset>
  <div class="field"><label for="scanFrequency">${esc(t('onboarding.frequency'))}</label><select id="scanFrequency" name="scanFrequency"><option value="balanced">${esc(t('onboarding.balanced'))}</option><option value="frequent">${esc(t('onboarding.frequent'))}</option><option value="gentle">${esc(t('onboarding.gentle'))}</option></select></div>
  <div class="field"><label for="dataRetentionDays">${esc(t('onboarding.retention'))}</label><input id="dataRetentionDays" name="dataRetentionDays" type="number" min="30" max="3650" value="365"></div>
  <p id="onboarding-status" class="status" role="status" aria-live="polite"></p><div class="dialog-actions"><button class="btn" type="submit">${esc(t('onboarding.submit'))}</button></div>
  </form></div></dialog>`;
}

function errorDialog() {
  return `<dialog id="user-error-dialog" aria-labelledby="user-error-title"><div class="dialog-body"><p id="user-error-code" class="eyebrow"></p><h2 id="user-error-title">發生問題</h2><p id="user-error-message"></p><ul id="user-error-recovery"></ul><p class="muted"><span id="user-error-version"></span><br><span id="user-error-time"></span><br><span id="user-error-reference"></span></p><div class="dialog-actions"><button id="user-error-copy" class="btn secondary" type="button">複製錯誤資訊</button><button id="user-error-report" class="btn secondary" type="button">問題回報</button><button id="user-error-close" class="btn" type="button">關閉</button></div></div></dialog>`;
}

function commonJs(t) { return `
const csrf=document.querySelector('meta[name="csrf-token"]')?.content||'';
const errorDialog=document.getElementById('user-error-dialog');let lastUserError=null;
function reportUrl(error){const query=new URLSearchParams({title:'['+error.code+'] Beyblade Tracker 問題回報',body:'錯誤代碼：'+error.code+'\\nApp version：'+error.appVersion+'\\nSupport reference：'+error.supportRef+'\\n\\n送出前請確認未包含 Token、Webhook、資料庫、完整 log、URL 或路徑。'});return 'https://github.com/yedongsian/beyblade-tracker/issues/new/choose?'+query}
function showUserError(error){if(!errorDialog||!error?.code)return;lastUserError=error;document.getElementById('user-error-code').textContent=error.code;document.getElementById('user-error-title').textContent=error.title;document.getElementById('user-error-message').textContent=error.message;const recovery=document.getElementById('user-error-recovery');recovery.replaceChildren(...(error.recovery||[]).map(step=>{const item=document.createElement('li');item.textContent=step;return item}));document.getElementById('user-error-version').textContent='App version：'+error.appVersion;document.getElementById('user-error-time').textContent='UTC：'+error.timestamp;document.getElementById('user-error-reference').textContent='Support reference：'+error.supportRef;if(!errorDialog.open)errorDialog.showModal();document.getElementById('user-error-close').focus()}
document.getElementById('user-error-close')?.addEventListener('click',()=>errorDialog.close());document.getElementById('user-error-copy')?.addEventListener('click',async()=>{if(!lastUserError)return;const text=['錯誤代碼：'+lastUserError.code,'App version：'+lastUserError.appVersion,'UTC：'+lastUserError.timestamp,'Support reference：'+lastUserError.supportRef].join('\\n');try{await navigator.clipboard.writeText(text)}catch{const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();document.execCommand('copy');area.remove()}});document.getElementById('user-error-report')?.addEventListener('click',()=>{if(lastUserError)window.open(reportUrl(lastUserError),'_blank','noopener,noreferrer')});
async function api(path,options={}){const headers={'Content-Type':'application/json','X-CSRF-Token':csrf,...(options.headers||{})};const res=await fetch(path,{...options,headers});let data={};try{data=await res.json()}catch{}if(!res.ok){const detail=data.error&&typeof data.error==='object'?data.error:null;const error=new Error(detail?.message||${JSON.stringify(t('js.failed'))});if(detail){error.detail=detail;showUserError(detail)}throw error}return data}
document.getElementById('language-picker')?.addEventListener('change',async(event)=>{event.target.disabled=true;try{await api('/api/settings/language',{method:'POST',body:JSON.stringify({language:event.target.value})});location.reload()}catch(error){event.target.disabled=false;alert(error.message)}});
`; }

function onboardingJs(t) { return `
const onboarding=document.getElementById('onboarding');if(onboarding){onboarding.showModal();const notification=document.getElementById('notification');const telegramFields=document.getElementById('onboarding-telegram');const toggleTelegram=()=>{telegramFields.hidden=notification.value!=='telegram'};notification.addEventListener('change',toggleTelegram);toggleTelegram();document.getElementById('onboarding-form').addEventListener('submit',async(event)=>{event.preventDefault();const status=document.getElementById('onboarding-status');const data=Object.fromEntries(new FormData(event.currentTarget));status.textContent=${JSON.stringify(t('js.saving'))};try{await api('/api/settings',{method:'POST',body:JSON.stringify(data)});if(data.notification==='telegram'&&data.telegramToken&&data.telegramChatId){await api('/api/notifications/telegram',{method:'POST',body:JSON.stringify({token:data.telegramToken,chatId:data.telegramChatId,test:true})})}status.textContent=${JSON.stringify(t('js.saved'))};onboarding.close();location.reload()}catch(error){status.className='status error';status.textContent=error.message}})}
`; }

export function settingsScript(t = createTranslator()) {
  const messages = { saved: t('js.saved'), checking: t('settings.checking'), noUpdate: t('settings.noUpdate'), importConfirm: t('settings.importConfirm'), updateAvailable: t('settings.updateAvailable'), updateDeferred: t('settings.updateDeferred'), updateDownloading: t('settings.updateDownloading'), updateInstalling: t('settings.updateInstalling'), updateRestarting: t('settings.updateRestarting'), updateFailed: t('settings.updateFailed'), updateConfirm: t('settings.updateConfirm'), updateVerified: t('settings.updateVerified'), updateHealthFailed: t('settings.updateHealthFailed'), rollbackConfirm: t('settings.rollbackConfirm'), rollbackQueued: t('settings.rollbackQueued'), rollbackSucceeded: t('settings.rollbackSucceeded'), rollbackFailed: t('settings.rollbackFailed') };
  return `
const settingsMessages=${JSON.stringify(messages)};const settingsStatus=document.getElementById('settings-status');const setSettingsStatus=(message,type='')=>{settingsStatus.className='status '+type;settingsStatus.textContent=message};
document.getElementById('telegram-form')?.addEventListener('submit',async event=>{event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));body.test=true;setSettingsStatus(settingsMessages.checking);try{await api('/api/notifications/telegram',{method:'POST',body:JSON.stringify(body)});setSettingsStatus(settingsMessages.saved,'success');setTimeout(()=>location.reload(),500)}catch(error){setSettingsStatus(error.message,'error')}});
document.getElementById('telegram-test')?.addEventListener('click',async()=>{setSettingsStatus(settingsMessages.checking);try{await api('/api/notifications/telegram/test',{method:'POST',body:'{}'});setSettingsStatus(settingsMessages.saved,'success')}catch(error){setSettingsStatus(error.message,'error')}});
document.getElementById('telegram-clear')?.addEventListener('click',async()=>{try{await api('/api/notifications/telegram',{method:'DELETE'});location.reload()}catch(error){setSettingsStatus(error.message,'error')}});
document.getElementById('transfer-export')?.addEventListener('click',async()=>{setSettingsStatus(settingsMessages.checking);try{const res=await fetch('/api/transfer/export',{method:'POST',headers:{'X-CSRF-Token':csrf}});if(!res.ok){const data=await res.json();throw new Error(data.error)}const blob=await res.blob();const disposition=res.headers.get('content-disposition')||'';const name=disposition.match(/filename="([^"]+)"/)?.[1]||'beyblade-transfer.beyblade-transfer';const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;link.click();URL.revokeObjectURL(link.href);setSettingsStatus(settingsMessages.saved,'success')}catch(error){setSettingsStatus(error.message,'error')}});
document.getElementById('transfer-import')?.addEventListener('change',async event=>{const file=event.target.files[0];if(!file||!confirm(settingsMessages.importConfirm))return;setSettingsStatus(settingsMessages.checking);try{const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));await api('/api/transfer/import',{method:'POST',body:JSON.stringify({data:btoa(binary)})});setSettingsStatus(settingsMessages.saved,'success')}catch(error){setSettingsStatus(error.message,'error')}});
document.getElementById('privacy-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const body={privacyAccepted:form.has('privacyAccepted'),sourcePolicyAccepted:form.has('sourcePolicyAccepted'),diagnosticsConsent:form.has('diagnosticsConsent')};try{await api('/api/privacy',{method:'POST',body:JSON.stringify(body)});setSettingsStatus(settingsMessages.saved,'success')}catch(error){setSettingsStatus(error.message,'error')}});
document.getElementById('diagnostics-export')?.addEventListener('click',async()=>{try{const res=await fetch('/api/diagnostics/export',{method:'POST',headers:{'X-CSRF-Token':csrf}});if(!res.ok){const data=await res.json();throw new Error(data.error)}const blob=await res.blob();const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='beyblade-diagnostics.json.gz';link.click();URL.revokeObjectURL(link.href)}catch(error){setSettingsStatus(error.message,'error')}});
const updateCard=document.getElementById('update-card');let availableUpdate=(()=>{try{return JSON.parse(updateCard?.dataset.scheduledUpdate||'null')?.manifest||null}catch{return null}})();let updateState=(()=>{try{return JSON.parse(updateCard?.dataset.updateState||'{}')}catch{return {}}})();let activeUpdateOperation=null;const updateDetails=document.getElementById('update-details');const updateHealth=document.getElementById('update-health');const updateProgress=document.getElementById('update-progress');const updateApply=document.getElementById('update-apply');const updateDefer=document.getElementById('update-defer');const updateResume=document.getElementById('update-resume');const updateRollback=document.getElementById('update-rollback');
function bytes(value){return new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(Number(value||0)/1048576)+' MB'}
function message(key,vars={}){return Object.entries(vars).reduce((value,[name,replacement])=>value.replaceAll('{'+name+'}',String(replacement)),settingsMessages[key])}
function renderHealth(data){const health=Object.hasOwn(data,'health')?data.health:updateState.health;const rollback=Object.hasOwn(data,'rollback')?data.rollback:updateState.rollback;if(!updateHealth)return;if(rollback?.status==='failed'){updateHealth.textContent=message('rollbackFailed',{code:rollback.code||'BT-UPD-007'});updateRollback.hidden=true}else if(health?.rollbackOffered){updateHealth.textContent=message('updateHealthFailed',{code:health.code||'BT-UPD-006'});updateRollback.hidden=false}else if(rollback?.status==='succeeded'){updateHealth.textContent=settingsMessages.rollbackSucceeded;updateRollback.hidden=true}else{updateHealth.textContent='';updateRollback.hidden=true}}
function renderUpdate(data){if(activeUpdateOperation)return;updateState=data.state||updateState;availableUpdate=data.manifest||null;const deferred=Boolean(data.deferred);if(!data.updateAvailable||!availableUpdate){updateDetails.textContent=settingsMessages.noUpdate;updateApply.hidden=true;updateDefer.hidden=true;updateResume.hidden=true;renderHealth(data);return}updateDetails.textContent=message(deferred?'updateDeferred':'updateAvailable',{version:availableUpdate.version})+'\n'+availableUpdate.publisher+' · '+bytes(availableUpdate.size)+' · '+availableUpdate.publishedAt+'\n'+availableUpdate.releaseNotes;updateApply.hidden=deferred;updateDefer.hidden=deferred;updateResume.hidden=!deferred;renderHealth(data)}
if(availableUpdate)renderUpdate({updateAvailable:true,manifest:availableUpdate,deferred:Boolean(updateState.deferred),health:updateState.health,rollback:updateState.rollback});setTimeout(async()=>{try{if(!activeUpdateOperation)renderUpdate(await api('/api/update/status',{method:'GET'}))}catch{/* status is optional while the service starts */}},1000);setInterval(async()=>{try{if(!activeUpdateOperation)renderUpdate(await api('/api/update/status',{method:'GET'}))}catch{/* keep the last verified result */}},60000);
async function pollUpdate(id){activeUpdateOperation=id;updateProgress.hidden=false;const timer=setInterval(async()=>{try{const data=await api('/api/update/progress/'+id,{method:'GET'});const percent=data.total?Math.min(100,Math.round(data.received/data.total*100)):0;updateProgress.value=percent;updateDetails.textContent=data.phase==='downloading'?message('updateDownloading',{percent}):data.phase==='installing'?settingsMessages.updateInstalling:data.phase==='completed'?settingsMessages.updateRestarting:data.error||settingsMessages.updateFailed;if(['completed','failed'].includes(data.phase)){clearInterval(timer);activeUpdateOperation=null;updateProgress.hidden=true;setSettingsStatus(data.phase==='completed'?settingsMessages.updateRestarting:data.error,data.phase==='completed'?'success':'error')}}catch(error){clearInterval(timer);activeUpdateOperation=null;updateProgress.hidden=true;setSettingsStatus(error.message,'error')}},400)}
document.getElementById('update-check')?.addEventListener('click',async()=>{setSettingsStatus(settingsMessages.checking);try{const data=await api('/api/update',{method:'GET'});renderUpdate(data);setSettingsStatus(data.updateAvailable?settingsMessages.updateVerified:settingsMessages.noUpdate,data.updateAvailable?'success':'')}catch(error){setSettingsStatus(error.message,'error')}});
updateDefer?.addEventListener('click',async()=>{if(!availableUpdate)return;try{await api('/api/update/defer',{method:'POST',body:JSON.stringify({targetVersion:availableUpdate.version,manifestDigest:availableUpdate.manifestDigest})});renderUpdate({updateAvailable:true,manifest:availableUpdate,deferred:true});setSettingsStatus(message('updateDeferred',{version:availableUpdate.version}),'success')}catch(error){setSettingsStatus(error.message,'error')}});
updateResume?.addEventListener('click',async()=>{try{await api('/api/update/resume',{method:'POST',body:'{}'});renderUpdate({updateAvailable:true,manifest:availableUpdate,deferred:false});setSettingsStatus(settingsMessages.saved,'success')}catch(error){setSettingsStatus(error.message,'error')}});
updateApply?.addEventListener('click',async()=>{if(!availableUpdate)return;if(!confirm(message('updateConfirm',{version:availableUpdate.version})))return;activeUpdateOperation='pending';setSettingsStatus(settingsMessages.checking);try{const data=await api('/api/update/apply',{method:'POST',body:JSON.stringify({confirmed:true,targetVersion:availableUpdate.version,manifestDigest:availableUpdate.manifestDigest})});updateApply.hidden=true;updateDefer.hidden=true;updateResume.hidden=true;pollUpdate(data.operationId)}catch(error){activeUpdateOperation=null;setSettingsStatus(error.message,'error')}});
updateRollback?.addEventListener('click',async()=>{if(!confirm(settingsMessages.rollbackConfirm))return;try{await api('/api/update/rollback',{method:'POST',body:'{}'});updateRollback.hidden=true;setSettingsStatus(settingsMessages.rollbackQueued,'success')}catch(error){setSettingsStatus(error.message,'error')}});
`;
}

export function sourcesScript(t = createTranslator()) {
  const messages = Object.fromEntries([
    'existing','existingHint','model','unrecognized','category','addMonitor','addDiscovery','previewTitle',
    'canonical','domain','scope','scopeValue','connection','existingLink','testing','previewDone','adding',
    'testingSource','testSuccess','checkQueued','disableConfirm','discovering','discoveryDone','discoverySaved',
  ].map((key) => [key, t(`sourceJs.${key}`)]));
  messages.states = Object.fromEntries(['discovered','coming_soon','preorder','in_stock','out_of_stock','unknown'].map((state) => [state, t(`state.${state}`)]));
  return `
const sourceMessages=${JSON.stringify(messages)};const msg=(value,vars={})=>Object.entries(vars).reduce((text,[key,replacement])=>text.replaceAll('{'+key+'}',String(replacement)),value);const form=document.getElementById('add-source-form');const preview=document.getElementById('source-preview');const status=document.getElementById('source-status');let lastPreview=null;
document.getElementById('network-toggle')?.addEventListener('click',async event=>{event.target.disabled=true;const output=document.getElementById('source-action-status');try{await api('/api/network',{method:'PATCH',body:JSON.stringify({enabled:event.target.dataset.enable==='true'})});location.reload()}catch(error){output.className='status error';output.textContent=error.message;event.target.disabled=false}});
function setStatus(message,type=''){status.className='status '+type;status.textContent=message}
function renderPreview(data){lastPreview=data;preview.hidden=false;const existing=data.existingSite?'<div class="notice warn"><strong>'+escapeHtml(sourceMessages.existing)+'</strong> '+escapeHtml(sourceMessages.existingHint)+'</div>':'';const candidate=data.candidate?'<div class="notice"><strong>'+escapeHtml(data.candidate.title)+'</strong><br>'+escapeHtml(sourceMessages.model)+'：'+escapeHtml(data.candidate.model||sourceMessages.unrecognized)+' · '+escapeHtml(sourceMessages.states[data.candidate.state]||data.candidate.state)+'</div>':'<div class="notice warn">'+escapeHtml(sourceMessages.category)+'</div>';const label=data.candidate?sourceMessages.addMonitor:sourceMessages.addDiscovery;preview.innerHTML=existing+'<h3>'+escapeHtml(sourceMessages.previewTitle)+'</h3><dl><dt>'+escapeHtml(sourceMessages.canonical)+'</dt><dd>'+escapeHtml(data.canonicalUrl)+'</dd><dt>'+escapeHtml(sourceMessages.domain)+'</dt><dd>'+escapeHtml(data.domain)+'</dd><dt>'+escapeHtml(sourceMessages.scope)+'</dt><dd>'+escapeHtml(sourceMessages.scopeValue)+'</dd><dt>'+escapeHtml(sourceMessages.connection)+'</dt><dd>'+escapeHtml(data.connection.message)+'</dd></dl>'+candidate+'<div class="actions"><a class="btn secondary" href="#source-list">'+escapeHtml(sourceMessages.existingLink)+'</a><button id="confirm-source" class="btn" '+(data.canConfirm?'':'disabled')+'>'+escapeHtml(label)+'</button></div>';document.getElementById('confirm-source')?.addEventListener('click',confirmSource)}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
form.addEventListener('submit',async(event)=>{event.preventDefault();const url=document.getElementById('source-url').value;preview.hidden=true;setStatus(sourceMessages.testing);const button=form.querySelector('button');button.disabled=true;try{const data=await api('/api/sources/preview',{method:'POST',body:JSON.stringify({url})});renderPreview(data);setStatus(sourceMessages.previewDone,'success')}catch(error){setStatus(error.message,'error')}finally{button.disabled=false}});
async function confirmSource(){if(!lastPreview)return;setStatus(sourceMessages.adding);try{const data=await api('/api/sources',{method:'POST',body:JSON.stringify({url:lastPreview.inputUrl,name:lastPreview.suggestedName,confirmed:true,discoveryOnly:!lastPreview.candidate})});setStatus(data.message,'success');setTimeout(()=>location.reload(),500)}catch(error){setStatus(error.message,'error')}}
document.querySelectorAll('[data-source-action]').forEach(button=>button.addEventListener('click',async()=>{const id=button.dataset.sourceId;const action=button.dataset.sourceAction;button.disabled=true;const output=document.getElementById('source-action-status');try{if(action==='test'){output.textContent=sourceMessages.testingSource;const data=await api('/api/sources/'+id+'/test',{method:'POST',body:'{}'});output.className='status success';output.textContent=msg(sourceMessages.testSuccess,{count:data.count})}else if(action==='check-now'){const data=await api('/api/sources/'+id+'/check-now',{method:'POST',body:'{}'});output.className='status success';output.textContent=data.message||sourceMessages.checkQueued}else{const enable=action==='enable';if(!enable&&!confirm(sourceMessages.disableConfirm))return;const data=await api('/api/sources/'+id,{method:'PATCH',body:JSON.stringify({enabled:enable})});output.className='status success';output.textContent=data.message;setTimeout(()=>location.reload(),400)}}catch(error){output.className='status error';output.textContent=error.message}finally{button.disabled=false}}));
document.querySelectorAll('[data-discovery-site]').forEach(button=>button.addEventListener('click',async()=>{const output=document.getElementById('source-action-status');button.disabled=true;output.className='status';output.textContent=sourceMessages.discovering;try{const data=await api('/api/sites/'+button.dataset.discoverySite+'/discover',{method:'POST',body:'{}'});output.className='status success';output.textContent=msg(sourceMessages.discoveryDone,{pages:data.run.pages_fetched,count:data.run.candidates_found});setTimeout(()=>location.href='/review',700)}catch(error){output.className='status error';output.textContent=error.message}finally{button.disabled=false}}));
document.querySelectorAll('[data-save-discovery]').forEach(button=>button.addEventListener('click',async()=>{const output=document.getElementById('source-action-status');const panel=document.querySelector('[data-discovery-settings="'+button.dataset.saveDiscovery+'"]');const values=Object.fromEntries([...panel.querySelectorAll('[data-setting]')].map(input=>[input.dataset.setting,input.value]));const body={maxPages:Number(values.maxPages),maxDepth:Number(values.maxDepth),maxSeconds:Number(values.maxSeconds),maxBytes:Number(values.maxMb)*1048576,intervalSeconds:Number(values.intervalHours)*3600,includeTerms:values.includeTerms,excludeTerms:values.excludeTerms};button.disabled=true;try{await api('/api/sites/'+button.dataset.saveDiscovery+'/discovery-settings',{method:'PATCH',body:JSON.stringify(body)});output.className='status success';output.textContent=sourceMessages.discoverySaved}catch(error){output.className='status error';output.textContent=error.message}finally{button.disabled=false}}));
`;
}

export function identityScript(t = createTranslator()) {
  const messages = { splitConfirm: t('identity.splitConfirm'), mergeConfirm: t('identity.mergeConfirm') };
  return `
const identityMessages=${JSON.stringify(messages)};const identityStatus=document.getElementById('identity-status');
document.getElementById('split-product-form')?.addEventListener('submit',async event=>{event.preventDefault();const offerIds=[...event.currentTarget.querySelectorAll('[name="splitOffer"]:checked')].map(input=>Number(input.value));if(!offerIds.length||!confirm(identityMessages.splitConfirm))return;const button=event.currentTarget.querySelector('button');button.disabled=true;try{const data=await api('/api/products/'+event.currentTarget.dataset.productId+'/split',{method:'POST',body:JSON.stringify({offerIds,name:new FormData(event.currentTarget).get('name')})});location.href='/products/'+data.created.product.id}catch(error){identityStatus.className='status error';identityStatus.textContent=error.message;button.disabled=false}});
document.getElementById('merge-product-form')?.addEventListener('submit',async event=>{event.preventDefault();if(!confirm(identityMessages.mergeConfirm))return;const data=Object.fromEntries(new FormData(event.currentTarget));const button=event.currentTarget.querySelector('button');button.disabled=true;try{const result=await api('/api/products/merge',{method:'POST',body:JSON.stringify({sourceProductId:Number(event.currentTarget.dataset.productId),targetProductId:Number(data.targetProductId),note:data.note})});location.href='/products/'+result.product.product.id}catch(error){identityStatus.className='status error';identityStatus.textContent=error.message;button.disabled=false}});
`;
}

export function exclusionScript(t = createTranslator()) {
  return `
const exclusionStatus=document.getElementById('exclusion-status');document.querySelectorAll('[data-exclusion-action]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm(${JSON.stringify(t('exclusions.confirmAction'))}))return;button.disabled=true;try{await api('/api/exclusions/'+button.dataset.exclusionId,{method:'POST',body:JSON.stringify({action:button.dataset.exclusionAction})});location.reload()}catch(error){exclusionStatus.className='status error';exclusionStatus.textContent=error.message;button.disabled=false}}));
`;
}

export function watchlistScript(t = createTranslator()) {
  const messages = {
    saved: t('watchlist.saved'), confirmDelete: t('watchlist.confirmDelete'),
    officialConfirmed: t('official.confirmed'), advanced: t('watchlist.regexWarning'),
  };
  return `
const watchMessages=${JSON.stringify(messages)};const watchStatus=document.getElementById('watchlist-status');
document.getElementById('watch-mode')?.addEventListener('change',event=>{if(event.target.value==='regex')watchStatus.textContent=watchMessages.advanced});
document.getElementById('watchlist-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const body=Object.fromEntries(form);body.notificationEvents=form.getAll('notificationEvents');body.synonymExpansion=true;watchStatus.className='status';try{const data=await api('/api/watchlists',{method:'POST',body:JSON.stringify(body)});watchStatus.className='status success';watchStatus.textContent=data.message||watchMessages.saved;setTimeout(()=>location.reload(),400)}catch(error){watchStatus.className='status error';watchStatus.textContent=error.message}});
document.querySelectorAll('[data-watch-action]').forEach(button=>button.addEventListener('click',async()=>{const action=button.dataset.watchAction;if(action==='delete'&&!confirm(watchMessages.confirmDelete))return;button.disabled=true;try{if(action==='delete')await api('/api/watchlists/'+button.dataset.watchId,{method:'DELETE'});else await api('/api/watchlists/'+button.dataset.watchId,{method:'PATCH',body:JSON.stringify({enabled:action==='enable'})});location.reload()}catch(error){watchStatus.className='status error';watchStatus.textContent=error.message;button.disabled=false}}));
document.querySelectorAll('[data-official-confirm]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{const data=await api('/api/official-sources/'+button.dataset.officialConfirm+'/confirm',{method:'POST',body:'{}'});watchStatus.className='status success';watchStatus.textContent=data.message||watchMessages.officialConfirmed;setTimeout(()=>location.reload(),400)}catch(error){watchStatus.className='status error';watchStatus.textContent=error.message;button.disabled=false}}));
`;
}

export function communityScript(t = createTranslator()) {
  const messages = { saved: t('community.saved') };
  return `
const communityMessages=${JSON.stringify(messages)};const communityStatus=document.getElementById('community-status');
document.querySelectorAll('[data-community-settings]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget));data.muted=Boolean(data.muted);data.filterSensitive=Boolean(data.filterSensitive);data.filterSpam=Boolean(data.filterSpam);event.currentTarget.querySelector('button').disabled=true;try{await api('/api/community-sources/'+event.currentTarget.dataset.communitySettings,{method:'PATCH',body:JSON.stringify(data)});communityStatus.className='status success';communityStatus.textContent=communityMessages.saved;setTimeout(()=>location.reload(),350)}catch(error){communityStatus.className='status error';communityStatus.textContent=error.message;event.currentTarget.querySelector('button').disabled=false}}));
const xCostDialog=document.getElementById('x-cost-dialog');const xCostAck=document.getElementById('x-cost-ack');const xConsoleLink=document.getElementById('x-console-link');
document.querySelectorAll('[data-x-self-setup]').forEach(button=>button.addEventListener('click',()=>{xCostAck.checked=false;xConsoleLink.setAttribute('aria-disabled','true');xCostDialog.showModal()}));
xCostAck?.addEventListener('change',()=>xConsoleLink.setAttribute('aria-disabled',xCostAck.checked?'false':'true'));
xConsoleLink?.addEventListener('click',event=>{if(!xCostAck.checked){event.preventDefault();xCostAck.focus()}});
document.getElementById('x-cost-cancel')?.addEventListener('click',()=>xCostDialog.close());
`;
}

export function reviewQueueScript(t = createTranslator()) {
  const messages = { choose: t('reviewJs.choose'), saving: t('reviewJs.saving'), done: t('reviewJs.done') };
  return `
const reviewMessages=${JSON.stringify(messages)};const reviewStatus=document.getElementById('review-status');
function chosen(){return [...document.querySelectorAll('[name="candidate"]:checked')].map(input=>Number(input.value))}
async function review(ids,action){if(!ids.length){reviewStatus.className='status error';reviewStatus.textContent=reviewMessages.choose;return}reviewStatus.className='status';reviewStatus.textContent=reviewMessages.saving;try{const data=await api('/api/candidates/review',{method:'POST',body:JSON.stringify({ids,action})});reviewStatus.className='status success';reviewStatus.textContent=reviewMessages.done.replace('{count}',data.candidates.length);setTimeout(()=>location.reload(),450)}catch(error){reviewStatus.className='status error';reviewStatus.textContent=error.message}}
document.querySelectorAll('[data-review-action]').forEach(button=>button.addEventListener('click',()=>review(chosen(),button.dataset.reviewAction)));
document.querySelectorAll('[data-single-review]').forEach(button=>button.addEventListener('click',()=>review([Number(button.dataset.candidateId)],button.dataset.singleReview)));
document.getElementById('select-all')?.addEventListener('change',event=>document.querySelectorAll('[name="candidate"]').forEach(input=>{input.checked=event.target.checked}));
`;
}

export function catalogScript(t) {
  const messages = {
    reviewing: t('terms.reviewing'), reviewed: t('terms.reviewed'), hint: t('terms.approveHint'),
  };
  return `
const termMessages=${JSON.stringify(messages)};const termStatus=document.getElementById('term-review-status');
document.querySelectorAll('[data-term-action]').forEach(button=>button.addEventListener('click',async()=>{const id=button.dataset.termId;const action=button.dataset.termAction;const select=document.querySelector('[data-term-value="'+id+'"]');const value=select?.value||null;if(action==='approve'&&button.dataset.termKind==='availability'&&!value){termStatus.className='status error';termStatus.textContent=termMessages.hint;return}button.disabled=true;termStatus.className='status';termStatus.textContent=termMessages.reviewing;try{await api('/api/terminology/'+id+'/review',{method:'POST',body:JSON.stringify({action,value})});termStatus.className='status success';termStatus.textContent=termMessages.reviewed;setTimeout(()=>location.reload(),450)}catch(error){termStatus.className='status error';termStatus.textContent=error.message}finally{button.disabled=false}}));
`;
}
import { createTranslator } from '../i18n.js';
