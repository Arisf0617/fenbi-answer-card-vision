// ==UserScript==
// @name         粉笔答题卡视觉识别录入助手
// @namespace    local.fenbi.answercard
// @version      1.2.6
// @description  在粉笔行测答题页识别答题卡并按题号录入（需要本地视觉模型服务）
// @updateURL     https://raw.githubusercontent.com/Arisf0617/fenbi-answer-card-vision/main/粉笔答题卡助手.user.js
// @downloadURL   https://raw.githubusercontent.com/Arisf0617/fenbi-answer-card-vision/main/粉笔答题卡助手.user.js
// @match        https://spa.fenbi.com/ti/exam/exercise/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self || window.__fenbiAnswerCardInstalled) return;
  window.__fenbiAnswerCardInstalled = true;
  const el = (tag, props = {}, text = '') => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'style') Object.assign(node.style, value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    if (text) node.textContent = text;
    return node;
  };
  const state = { config: null, image: null, imageUrl: '', imageVersion: 0, crop: null, rows: [], busy: false, stop: false, nonce: '', questions: null, originalUrl: location.href };
  const FenbiCore = (() => {
    function scan(doc) {
      const map = new Map();
      for (const node of doc.querySelectorAll('app-ti[data-question-key]')) {
        const match = (node.querySelector('.title-index')?.textContent.trim() || '').match(/^(\d+)\s*[.．、]?$/);
        if (!match) throw Error('题号格式变化，已停止录入');
        const number=Number(match[1]);if(map.has(number))throw Error(`题号 ${number} 重复`);
        if(node.querySelector('.title-type-name')?.textContent.trim()!=='单选题')continue;
        const options=new Map();
        for(const label of node.querySelectorAll('app-choice-radio label.choice-radio-label')){const letter=label.querySelector('.input-radio')?.textContent.trim(),input=label.querySelector('input[type="radio"]');if(!/^[A-E]$/.test(letter||'')||!input||options.has(letter))throw Error(`第 ${number} 题选项结构异常`);options.set(letter,{input,label});}
        if(options.size<4||options.size>5)throw Error(`第 ${number} 题没有可用选项`);
        map.set(number,{number,el:node,key:node.getAttribute('data-question-key'),options});
      }
      if(!map.size)throw Error('没有找到粉笔单选题控件');return map;
    }
    function selected(q){const a=[...q.options].filter(([,v])=>v.input.checked).map(([k])=>k);if(a.length>1)throw Error(`第 ${q.number} 题有多个选中项`);return a[0]||null;}
    function plan(rows,map,overwrite){const p={write:[],same:[],conflict:[],skip:[],missing:[]},seen=new Set();for(const r of rows){if(!Number.isInteger(r.number)||seen.has(r.number))throw Error('答案题号重复或无效');seen.add(r.number);if(!/^[A-E]$/.test(r.answer||'')){p.skip.push(r);continue;}const q=map.get(r.number);if(!q||!q.options.has(r.answer)){p.missing.push(r);continue;}const before=selected(q),item={...r,before,key:q.key};if(before===r.answer)p.same.push(item);else if(before&&!overwrite)p.conflict.push(item);else p.write.push(item);}return p;}
    async function apply(rows,{doc,overwrite,isCancelled,isCurrent,onProgress,wait}){const p=plan(rows,scan(doc),overwrite);if(p.missing.length)throw Error('页面缺少题号或选项：'+p.missing.map(r=>r.number).join('、'));const done=[];for(const r of p.write){if(isCancelled())return{...p,done,cancelled:true};if(!isCurrent())throw Error(`页面变化，已写入 ${done.length} 题后停止`);let q=scan(doc).get(r.number);if(!q||q.key!==r.key||selected(q)!==r.before)throw Error(`第 ${r.number} 题页面或答案已变化，已写入 ${done.length} 题后停止`);const option=q.options.get(r.answer);if(option.input.disabled||!option.label.isConnected)throw Error(`第 ${r.number} 题不可点击`);option.label.click();let ok=false;for(let i=0;i<12;i++){await wait(80);q=scan(doc).get(r.number);if(!isCurrent()||q?.key!==r.key)break;if(selected(q)===r.answer){ok=true;break;}}if(!ok)throw Error(`第 ${r.number} 题未能核实，已写入 ${done.length} 题后停止`);done.push(r);onProgress(r,done.length,p.write.length);await wait(80);}const final=scan(doc);for(const r of done)if(final.get(r.number)?.key!==r.key||selected(final.get(r.number))!==r.answer)throw Error(`最后核对第 ${r.number} 题失败`);return{...p,done,cancelled:false};}
    return{scan,selected,plan,apply};
  })();
  const style = el('style');
  style.textContent = `#fbac-root{position:fixed;z-index:2147483647;right:16px;top:90px;width:380px;max-height:calc(100vh - 110px);background:#fff;color:#25352d;border:1px solid #bed0c5;border-radius:8px;box-shadow:0 8px 32px #172a2033;font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif}#fbac-root *{box-sizing:border-box}#fbac-head{background:#176c4c;color:white;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;border-radius:7px 7px 0 0;cursor:move}#fbac-body{padding:12px;overflow:auto;max-height:calc(100vh - 162px)}#fbac-root label{display:block;margin:8px 0 3px;color:#4d6256}#fbac-root input:not([type=checkbox]),#fbac-root select,#fbac-root textarea{display:block;width:100%;margin-top:3px;border:1px solid #c8d7ce;border-radius:4px;padding:6px;font:inherit;color:#24372d;background:white}#fbac-root input[type=file]{width:100%;font-size:12px}#fbac-root textarea{height:100px;resize:vertical;font-size:11px}#fbac-root button{border:1px solid #b7ccc0;border-radius:4px;background:#fff;color:#24563f;padding:6px 9px;cursor:pointer;font:inherit}#fbac-root button.primary{background:#176c4c;color:white;border-color:#176c4c}#fbac-root button:disabled{opacity:.5;cursor:wait}#fbac-root .fbac-row{display:flex;gap:7px;align-items:center}#fbac-root .fbac-row>*{flex:1;min-width:0}#fbac-root .fbac-hint{font-size:11px;color:#62766a;margin:5px 0}#fbac-status{white-space:pre-wrap;margin:8px 0;font-size:12px}#fbac-error{color:#a12d2d;white-space:pre-wrap}#fbac-list{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;max-height:205px;overflow:auto}#fbac-list label{margin:0;border:1px solid #d8e3dc;border-radius:4px;padding:4px;font-size:10px}#fbac-list label.warn{background:#fff2d6;border:2px solid #c77c00;color:#704600;font-weight:700}#fbac-list label.warn select{border:2px solid #c77c00;background:#fff9eb;color:#704600;font-weight:700}#fbac-review{display:none;margin:7px 0;padding:8px 10px;border-left:4px solid #c77c00;background:#fff2d6;color:#704600;font-weight:700}#fbac-review.active{display:block}#fbac-preview{width:100%;height:auto;max-height:none;object-fit:fill;display:block;cursor:crosshair;background:#edf1ef;margin-top:7px;touch-action:none;user-select:none}#fbac-preview[hidden]{display:none}#fbac-hidden{display:none}#fbac-root details summary{cursor:pointer;color:#176c4c}#fbac-min{border:0!important;background:transparent!important;color:white!important;font-size:18px!important;padding:0 4px!important}`;
  style.textContent += `
    #fbac-root .fbac-defaults{margin:8px 0}
    #fbac-config-feedback{margin:0 0 5px;font-size:12px;color:#176c4c}
    #fbac-config-feedback:empty{display:none}
    #fbac-config-feedback.error{color:#a12d2d}
    #fbac-connection{margin:4px 0 10px;font-size:12px;font-weight:600}
    #fbac-connection.ok{color:#16804a}
    #fbac-connection.error{color:#b42318}
    #fbac-connection.checking{color:#62766a;font-weight:400}
    #fbac-prompt-feedback{min-height:18px;margin:3px 0 8px;font-size:11px;color:#16804a}
    #fbac-prompt-feedback.error{color:#b42318}
    #fbac-working{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;padding:12px;margin:8px 0;background:#e9f6ef;border:1px solid #a3cfb6;border-radius:6px;box-shadow:0 3px 8px #1233}
    #fbac-working[hidden]{display:none}
    #fbac-working .fbac-spinner{width:22px;height:22px;flex:none;border:3px solid #b9ddc9;border-top-color:#176c4c;border-radius:50%;animation:fbac-spin .8s linear infinite}
    #fbac-working-text{font-weight:600}#fbac-working-time{font-size:12px;color:#496958}
    #fbac-root[aria-busy=true] #fbac-head strong::after{content:' · 处理中';font-size:11px;font-weight:400}
    #fbac-open-web{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;margin-left:4px;border:1px solid #ffffff66;border-radius:4px;color:white;text-decoration:none;font-size:18px;line-height:1}
    @keyframes fbac-spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){#fbac-working .fbac-spinner{animation:none;border-style:dotted}}
  `;
  document.documentElement.append(style);
  const root = el('aside', { id: 'fbac-root' });
  const head = el('div', { id: 'fbac-head' });
  head.append(el('strong', {}, '答题卡识别录入'), el('button', { id: 'fbac-min', title: '收起/展开' }, '−'), el('a', { id: 'fbac-open-web', href: 'http://127.0.0.1:8765/', target: '_blank', rel: 'noopener', title: '打开本地服务网页（新标签页）', 'aria-label': '打开本地服务网页' }, '↗'));
  const body = el('div', { id: 'fbac-body' });
  root.append(head, body); document.documentElement.append(root);
  let collapsed = false;
  head.querySelector('button').onclick = e => { e.stopPropagation(); collapsed = !collapsed; body.hidden = collapsed; root.style.width = collapsed ? '185px' : '380px'; };
  let moving = null;
  head.onpointerdown = e => { if (e.target.closest('button,a')) return; const r = root.getBoundingClientRect(); moving = { x: e.clientX - r.left, y: e.clientY - r.top }; head.setPointerCapture(e.pointerId); };
  head.onpointermove = e => { if (!moving) return; root.style.left = `${Math.max(0, Math.min(innerWidth - root.offsetWidth, e.clientX - moving.x))}px`; root.style.top = `${Math.max(0, Math.min(innerHeight - 60, e.clientY - moving.y))}px`; root.style.right = 'auto'; };
  head.onpointerup = () => { moving = null; };
  const endpoint = el('input', { id: 'fbac-endpoint', value: GM_getValue('endpoint', 'http://127.0.0.1:8765'), autocomplete: 'off' });
  const openWeb=document.getElementById('fbac-open-web');openWeb.href=endpoint.value.trim().replace(/\/$/,'')+'/';
  const base = el('input', { id: 'fbac-base', value: GM_getValue('base', 'https://api.aijws.com/v1'), autocomplete: 'off' });
  const model = el('input', { id: 'fbac-model', value: GM_getValue('model', 'gpt-6.1-sol'), placeholder: '视觉模型 ID', autocomplete: 'off' });
  const key = el('input', { id: 'fbac-key', type: 'password', value: GM_getValue('apiKey', ''), placeholder: '填写后可保存为默认，不写入脚本文件', autocomplete: 'off' });
  const file = el('input', { id: 'fbac-file', type: 'file', accept: 'image/*', capture: 'environment' });
  const preview = el('canvas', { id: 'fbac-preview', title: '按住并拖动框选答题区，松开后保留选区' });
  preview.hidden=true;
  const cropInfo=el('p',{className:'fbac-hint',id:'fbac-crop-info'},'未选择照片');
  const start = el('input', { id: 'fbac-start', type: 'number', min: 1, max: 300, value: '1' });
  const end = el('input', { id: 'fbac-end', type: 'number', min: 1, max: 300, value: '140' });
  const choices = el('select', { id: 'fbac-choices' }); for (const [v, text] of [[4, 'A–D'], [5, 'A–E']]) choices.append(el('option', { value: String(v) }, text));
  const tiles = el('input', { id: 'fbac-tiles', type: 'checkbox', checked: true });
  const test = el('button', {}, '测试模型连接'); const recognize = el('button', { className: 'primary' }, '识别答题卡');
  const overwrite = el('input', { id: 'fbac-overwrite', type: 'checkbox' }); const apply = el('button', { className: 'primary', disabled: true }, '写入粉笔答题');
  const cancel = el('button', { disabled: true }, '停止后续写入');
  const status = el('p', { id: 'fbac-status', role: 'status' }, '正在检测粉笔答题控件…'); const errorBox = el('p', { id: 'fbac-error', role: 'alert' });
  const list = el('div', { id: 'fbac-list' }); const sequence = el('textarea', { readonly: true, placeholder: '识别后显示，— 未涂，? 待核对' });
  const reviewNotice=el('p',{id:'fbac-review',role:'alert','aria-live':'assertive'});
  const saveDefaults=el('button',{},'保存配置');
  const clearKey=el('button',{},'清除配置');
  const configFeedback=el('p',{id:'fbac-config-feedback',role:'status','aria-live':'polite'});
  const connection=el('p',{id:'fbac-connection',className:'checking',role:'status','aria-live':'polite'},'… 正在检测本地识别服务');
  const configActions=el('div',{className:'fbac-row fbac-defaults'});configActions.append(saveDefaults,clearKey);
  const working=el('div',{id:'fbac-working',hidden:true,role:'status'});
  const workingText=el('div',{id:'fbac-working-text'},'准备识别');
  const workingTime=el('div',{id:'fbac-working-time'},'已等待 0 秒');
  const workingLabels=el('div');workingLabels.append(workingText,workingTime);working.append(el('span',{className:'fbac-spinner','aria-hidden':'true'}),workingLabels);
  const sendTiles = el('label', {}, ' 发送 4 张重叠局部图（额外费用）'); sendTiles.prepend(tiles);
  const overLabel = el('label', {}, ' 允许覆盖网页里已有的不同答案'); overLabel.prepend(overwrite);
  const field=(name,input)=>{const l=el('label');l.append(document.createTextNode(name),input);return l;};
  const rangeRow=el('div',{className:'fbac-row'});rangeRow.append(field('起始题号',start),field('结束题号',end),field('选项数',choices));
  const actions=el('div',{className:'fbac-row'});actions.append(test,recognize);
  const writeActions=el('div',{className:'fbac-row'});writeActions.append(apply,cancel);
  body.append(field('本地识别服务地址',endpoint),connection,field('模型 API 基础地址',base),field('视觉模型名称',model),field('API Key',key),configActions,configFeedback,el('p',{className:'fbac-hint'},'API Key 仅保存在 Tampermonkey 本地。'),field('答题卡照片',file),preview,cropInfo,
    el('p',{className:'fbac-hint'},'按住拖动框选答题区，松开后保留。用“恢复整图”取消裁剪。照片会发送给配置的模型服务商。'),
    rangeRow,sendTiles,actions,working,status,errorBox,el('hr'),el('strong',{},'识别结果（检查后再写入）'),reviewNotice,list,sequence,
    el('p',{className:'fbac-hint'},'冲突答案默认跳过；疑问与空题不会录入。不会点击“交卷”。'),overLabel,writeActions);
  const hr = body.querySelector('hr');
  const defaults = el('details'); const summary = el('summary', {}, '查看 / 修改识别提示词'); const prompt = el('textarea', { placeholder: '默认提示词将在本地服务启动时载入', maxLength: 8000 });
  const promptFeedback=el('p',{id:'fbac-prompt-feedback',role:'status','aria-live':'polite'});
  defaults.append(summary, el('label', {}, '识别提示词'), prompt, promptFeedback); hr.before(defaults);
  // Add buttons for image rotation and crop reset.
  const cropButtons = el('div', { className: 'fbac-row' }); const clearCrop = el('button', {}, '恢复整图'), rotate = el('button', {}, '旋转 90°'); cropButtons.append(clearCrop, rotate); preview.after(cropButtons);

  function call(path, payload, timeout = 20000) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: payload ? 'POST' : 'GET', url: endpoint.value.replace(/\/$/, '') + path,
      headers: payload ? { 'Content-Type': 'application/json', 'X-Local-Token': state.nonce } : {},
      data: payload ? JSON.stringify(payload) : undefined, timeout, anonymous: true, redirect: 'error',
      onload: r => { let data; try { data = JSON.parse(r.responseText); } catch { reject(Error('本地服务未返回有效 JSON')); return; } if (r.status < 200 || r.status >= 300) reject(Error(data.error || `本地服务 HTTP ${r.status}`)); else resolve(data); },
      onerror: () => reject(Error('无法连接本地服务；请运行启动.cmd，并确认地址正确')),
      ontimeout: () => reject(Error('本地服务请求超时')),
    }));
  }
  function getQuestions() { if (state.questions && state.questions.size) return state.questions; state.questions = FenbiCore.scan(document); return state.questions; }
  function refreshQuestions() { state.questions = null; return getQuestions(); }
  function defaultQuestionCount(){const text=[document.title,...[...document.querySelectorAll('h1,h2,h3,[class*="title"],[class*="name"]')].slice(0,80).map(node=>node.textContent||'')].join(' ');if(/副省级/.test(text))return 135;if(/行政执法|地市级/.test(text))return 130;return 140;}
  function authPayload() { if (!model.value.trim() || !key.value.trim()) throw Error('请填写视觉模型名称和 API Key'); return { base: base.value.trim(), model: model.value.trim(), key: key.value }; }
  function canvasImage(rect) { const c = document.createElement('canvas'), scale = Math.min(1, 2400 / Math.max(rect.w, rect.h)); c.width = Math.max(1, Math.round(rect.w * scale)); c.height = Math.max(1, Math.round(rect.h * scale)); c.getContext('2d').drawImage(state.image, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', .94); }
  function imagePayload() { const r = state.crop || { x: 0, y: 0, w: state.image.width, h: state.image.height }; const images = [canvasImage(r)]; if (tiles.checked) for (const y of [0, .44]) for (const x of [0, .44]) images.push(canvasImage({ x: r.x + x*r.w, y: r.y + y*r.h, w: .56*r.w, h: .56*r.h })); return images; }
  function draw() { if (!state.image) return; preview.width = state.image.width; preview.height = state.image.height; const c = preview.getContext('2d'); c.drawImage(state.image,0,0); if(state.crop){c.fillStyle='#0007';c.fillRect(0,0,preview.width,preview.height);c.drawImage(state.image,state.crop.x,state.crop.y,state.crop.w,state.crop.h,state.crop.x,state.crop.y,state.crop.w,state.crop.h);c.strokeStyle='#00cc88';c.lineWidth=Math.max(2,preview.width/300);c.strokeRect(state.crop.x,state.crop.y,state.crop.w,state.crop.h);}cropInfo.textContent=state.crop?`已选答题区 ${Math.round(state.crop.w)} × ${Math.round(state.crop.h)} 像素；识别只发送此区域`:`整图 ${preview.width} × ${preview.height} 像素；可按住拖动框选`;}
  let drag=null;
  function imagePoint(e){const r=preview.getBoundingClientRect();return{x:Math.max(0,Math.min(preview.width,(e.clientX-r.left)*preview.width/r.width)),y:Math.max(0,Math.min(preview.height,(e.clientY-r.top)*preview.height/r.height))};}
  function updateCrop(e){const p=imagePoint(e),a=drag.start;return{x:Math.min(p.x,a.x),y:Math.min(p.y,a.y),w:Math.abs(p.x-a.x),h:Math.abs(p.y-a.y)};}
  preview.onpointerdown=e=>{if(!state.image||state.busy||e.button!==0)return;e.preventDefault();drag={start:imagePoint(e),previous:state.crop,pointerId:e.pointerId};preview.setPointerCapture(e.pointerId);};
  preview.onpointermove=e=>{if(!drag||e.pointerId!==drag.pointerId)return;e.preventDefault();state.crop=updateCrop(e);draw();};
  preview.onpointerup=e=>{if(!drag||e.pointerId!==drag.pointerId)return;e.preventDefault();const next=updateCrop(e);state.crop=next.w>=15&&next.h>=15?next:drag.previous;drag=null;if(preview.hasPointerCapture(e.pointerId))preview.releasePointerCapture(e.pointerId);draw();};
  preview.onpointercancel=preview.onlostpointercapture=()=>{if(!drag)return;state.crop=drag.previous;drag=null;draw();};
  clearCrop.onclick=()=>{state.crop=null;draw();};
  rotate.onclick=()=>{if(!state.image||state.busy)return;const c=document.createElement('canvas');c.width=state.image.height;c.height=state.image.width;const x=c.getContext('2d');x.translate(c.width,0);x.rotate(Math.PI/2);x.drawImage(state.image,0,0);state.image=c;state.crop=null;draw();};
  file.onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>25*1024*1024){errorBox.textContent='照片不能超过 25 MB';return;}const version=++state.imageVersion,url=URL.createObjectURL(f),im=new Image();im.onload=()=>{URL.revokeObjectURL(url);if(version!==state.imageVersion)return;const c=document.createElement('canvas'),scale=Math.min(1,3200/Math.max(im.width,im.height));c.width=Math.round(im.width*scale);c.height=Math.round(im.height*scale);c.getContext('2d').drawImage(im,0,0,c.width,c.height);state.image=c;state.crop=null;state.rows=[];preview.hidden=false;draw();renderRows();status.textContent='照片已载入；框选答题区并设置题号范围。';errorBox.textContent='';};im.onerror=()=>{URL.revokeObjectURL(url);errorBox.textContent='照片无法读取';};im.src=url;};
  function renderRows(){list.replaceChildren();for(const r of state.rows){const needsReview=r.answer==='?';const box=el('label',{className:needsReview?'warn':''});box.append(document.createTextNode(`${r.number} `));const sel=el('select');for(const v of ['?','-',...'ABCDE'.slice(0,r.choices)])sel.append(el('option',{value:v},v==='?'?'? 待核对':v==='-'?'— 空题':v));sel.value=r.answer;sel.onchange=()=>{r.answer=sel.value;r.status='manual';box.className=r.answer==='?'?'warn':'';sync();};box.append(sel);list.append(box);}sequence.value=state.rows.map(x=>x.answer).join('');const unresolved=state.rows.filter(x=>x.answer==='?');reviewNotice.classList.toggle('active',unresolved.length>0);reviewNotice.textContent=unresolved.length?`⚠ 有 ${unresolved.length} 题无法确认，请核对高亮题号：${unresolved.map(x=>x.number).join('、')}`:'';apply.disabled=!state.rows.length||state.busy;}
  function sync(){sequence.value=state.rows.map(x=>x.answer).join('');const p=state.rows.length?FenbiCore.plan(state.rows,getQuestions(),overwrite.checked):null;const uncertain=state.rows.filter(x=>x.answer==='?').length,blank=state.rows.filter(x=>x.answer==='-').length;status.textContent=p?`识别 ${state.rows.length} 题：${state.rows.length-uncertain-blank} 个单选，${blank} 空题，${uncertain} 待核；已有冲突 ${p.conflict.length} 题，页面缺题 ${p.missing.length} 题。`:'';apply.disabled=!state.rows.some(x=>/^[A-E]$/.test(x.answer))||state.busy;}
  let busyTimer=null,busyStarted=0;
  function showWorking(title){workingText.textContent=title;working.hidden=false;busyStarted=Date.now();const tick=()=>{const seconds=Math.floor((Date.now()-busyStarted)/1000);workingTime.textContent=`已等待 ${seconds} 秒 · ${seconds<45?'正在等待模型返回':seconds<120?'模型仍在处理，请稍候':'等待时间较长，返回或超时后会自动提示'}`;};tick();clearInterval(busyTimer);busyTimer=setInterval(tick,1000);working.scrollIntoView({block:'nearest'});}
  function setBusy(v,title='正在识别答题卡…'){state.busy=v;root.setAttribute('aria-busy',String(v));for(const n of body.querySelectorAll('input,select,textarea,button'))if(n!==cancel)n.disabled=v;cancel.disabled=!v;apply.disabled=v||!state.rows.length;if(v)showWorking(title);else{clearInterval(busyTimer);busyTimer=null;working.hidden=true;}recognize.textContent=v?'处理中…':'识别答题卡';}
  const yieldFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  test.onclick=async()=>{errorBox.textContent='';try{const auth=authPayload();if(!state.nonce)throw Error('本地连接未初始化，请重试');const colors=['red','green','blue'],expected=colors[crypto.getRandomValues(new Uint32Array(1))[0]%3],c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,256,256);x.fillStyle={red:'#f00000',green:'#009b35',blue:'#004dff'}[expected];x.fillRect(48,48,160,160);setBusy(true,'正在测试模型图片连接…');status.textContent='正在测试模型和图片输入…';await yieldFrame();const d=await call('/api/test',{...auth,image:c.toDataURL('image/jpeg',.94),expected},200000);status.textContent=`连接和图片测试通过，耗时 ${(d.elapsedMs/1000).toFixed(1)} 秒；不代表答题卡准确率。`;}catch(e){errorBox.textContent=e.message;}finally{setBusy(false);}};
  recognize.onclick=async()=>{errorBox.textContent='';try{if(!state.image)throw Error('请先选照片');if(state.originalUrl!==location.href)throw Error('答题页面已变化，请重新确认题号');const auth=authPayload(),from=Number(start.value),to=Number(end.value);if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>300)throw Error('题号范围无效');setBusy(true,'正在准备答题区图片…');status.textContent='正在识别，请稍候…';await yieldFrame();const imageData=imagePayload();workingText.textContent='图片已准备，正在请求视觉模型…';await yieldFrame();const d=await call('/api/recognize',{...auth,start:from,end:to,choices:Number(choices.value),prompt:prompt.value,images:imageData},200000);state.rows=d.answers.map(r=>({...r,choices:Number(choices.value)}));renderRows();sync();}catch(e){errorBox.textContent=e.message;}finally{setBusy(false);renderRows();if(state.rows.some(r=>r.answer==='?'))reviewNotice.scrollIntoView({block:'nearest',behavior:'smooth'});}}
  cancel.onclick=()=>{state.stop=true;cancel.disabled=true;status.textContent+='\n收到停止请求；正在完成当前题并停止后续写入。';};
  apply.onclick=async()=>{errorBox.textContent='';try{if(overwrite.checked&&!confirm('你已允许覆盖粉笔页面中已有的不同答案。继续写入本次识别结果？'))return;const map=refreshQuestions(),p=FenbiCore.plan(state.rows,map,overwrite.checked);if(p.missing.length)throw Error('页面缺少题号/选项：'+p.missing.map(x=>x.number).join('、'));const conflicts=p.conflict.map(x=>x.number);const skipped=p.skip.length;if(!p.write.length){status.textContent=`无需写入。已有相同答案 ${p.same.length}，冲突 ${conflicts.length}，空题或疑问跳过 ${skipped}。`;return;}const preview=`准备写入 ${p.write.length} 题。已有相同答案 ${p.same.length} 题；冲突跳过 ${conflicts.length} 题；空题/疑问跳过 ${skipped} 题。\n将写入：${p.write.slice(0,18).map(x=>x.number+x.answer).join(' ')}${p.write.length>18?' …':''}\n\n确认逐题写入？不会提交答卷。`;if(!confirm(preview))return;state.stop=false;setBusy(true,'正在逐题写入粉笔…');const result=await FenbiCore.apply(state.rows,{doc:document,overwrite:overwrite.checked,isCancelled:()=>state.stop,isCurrent:()=>location.href===state.originalUrl,onProgress:(r,n,total)=>{status.textContent=`写入中 ${n}/${total}；最近核实第 ${r.number} 题为 ${r.answer}。`;},wait:ms=>new Promise(r=>setTimeout(r,ms))});status.textContent=`录入结束：成功核实 ${result.done.length} 题；已有相同答案 ${result.same.length}；冲突跳过 ${result.conflict.length}；空题/疑问跳过 ${result.skip.length}${result.cancelled?'；已按要求停止':''}。未交卷。`; }catch(e){errorBox.textContent=e.message;}finally{state.stop=false;setBusy(false);renderRows();}};
  saveDefaults.onclick=()=>{try{GM_setValue('endpoint',endpoint.value.trim());GM_setValue('base',base.value.trim());GM_setValue('model',model.value.trim());GM_setValue('apiKey',key.value.trim());configFeedback.className='';configFeedback.textContent='配置已保存，刷新答题页后会自动填入。';}catch(e){configFeedback.className='error';configFeedback.textContent='保存失败：'+e.message;}};
  clearKey.onclick=()=>{try{GM_setValue('endpoint','http://127.0.0.1:8765');GM_setValue('base','https://api.aijws.com/v1');GM_setValue('model','gpt-6.1-sol');GM_setValue('apiKey','');GM_setValue('prompt','');endpoint.value='http://127.0.0.1:8765';base.value='https://api.aijws.com/v1';model.value='gpt-6.1-sol';key.value='';prompt.value='';promptEdited=true;promptFeedback.textContent='已清空自定义提示词，将使用内置默认提示词。';openWeb.href=endpoint.value+'/';configFeedback.className='';configFeedback.textContent='已清除保存的配置，并恢复默认地址和模型。';}catch(e){configFeedback.className='error';configFeedback.textContent='清除失败：'+e.message;}};
  base.onchange=()=>GM_setValue('base',base.value.trim());model.onchange=()=>GM_setValue('model',model.value.trim());
  let promptEdited=false,connectionCheck=0;
  function setConnection(text,stateName){connection.className=stateName;connection.textContent=text;}
  async function initialize(){const target=endpoint.value.trim();const check=++connectionCheck;setConnection('… 正在检测本地识别服务','checking');try{const c=await call('/api/config');if(check!==connectionCheck||target!==endpoint.value.trim())return;state.nonce=c.token;state.config=c;setConnection('✓ 本地服务已连接','ok');if(!promptEdited){const savedPrompt=GM_getValue('prompt',null);prompt.value=savedPrompt===null?c.prompt||'':savedPrompt;}try{for(let i=0;i<25;i++){try{refreshQuestions();break;}catch{if(i===24)throw Error('粉笔题目仍未加载，稍后刷新答题页');await new Promise(r=>setTimeout(r,400));}}const count=defaultQuestionCount();end.value=String(count);status.textContent=`题目数量已设为 ${count} 道；已加载 ${state.questions.size} 道单选题。`;}catch(e){errorBox.textContent=e.message;}}catch(e){if(check!==connectionCheck||target!==endpoint.value.trim())return;state.nonce='';setConnection('✕ 本地服务连接失败：'+e.message,'error');errorBox.textContent='本地连接未就绪：'+e.message;}}
  prompt.oninput=()=>{promptEdited=true;try{GM_setValue('prompt',prompt.value);promptFeedback.className='';promptFeedback.textContent='提示词已自动保存';}catch(e){promptFeedback.className='error';promptFeedback.textContent='提示词保存失败：'+e.message;}};
  endpoint.oninput=()=>{openWeb.href=endpoint.value.trim().replace(/\/$/,'')+'/';};
  endpoint.onchange=()=>{GM_setValue('endpoint',endpoint.value.trim());state.nonce='';initialize();};
  initialize();
})();
