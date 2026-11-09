/* Shared pure validation and DOM adapter. Included in the standalone userscript. */
const FenbiCore = (() => {
  function normalize(raw,start,end,choices) {
    if(typeof raw!=='string')throw Error('模型未返回文本 JSON');
    let obj;try{obj=JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{throw Error('模型返回的 JSON 无效，未采用本次结果');}
    if(!obj||!Array.isArray(obj.answers))throw Error('模型结果缺少 answers 数组');
    const rows=new Map(Array.from({length:end-start+1},(_,i)=>[start+i,{number:start+i,answer:'?',status:'uncertain',note:'模型遗漏此题'}]));
    const seen=new Set();
    for(const r of obj.answers){
      if(!r||!Number.isInteger(r.number)||!rows.has(r.number)||seen.has(r.number))throw Error('存在重复、越界或无效题号，未采用本次结果');
      seen.add(r.number);let answer='?',status=r.status,note=String(r.note||'').slice(0,240);
      if(status==='answered'&&typeof r.answer==='string'&&r.answer.length===1&&'ABCDE'.slice(0,choices).includes(r.answer))answer=r.answer;
      else if(status==='blank'&&[null,'','-',undefined].includes(r.answer))answer='-';
      else if(!['multiple','uncertain'].includes(status)){status='uncertain';note='无效答案或状态；'+note;}
      rows.set(r.number,{number:r.number,answer,status,note});
    }
    return [...rows.values()];
  }
  function scan(doc) {
    const map=new Map();
    for(const el of doc.querySelectorAll('app-ti[data-question-key]')) {
      const text=el.querySelector('.title-index')?.textContent.trim()||'';
      const match=text.match(/^(\d+)\s*[.．、]?$/);
      if(!match)throw Error('题号格式已变化，停止录入');
      const number=Number(match[1]);if(map.has(number))throw Error(`页面题号 ${number} 重复，停止录入`);
      const type=el.querySelector('.title-type-name')?.textContent.trim();
      if(type!=='单选题')continue;
      const labels=[...el.querySelectorAll('app-choice-radio label.choice-radio-label')];
      const options=new Map();
      for(const label of labels){const letter=label.querySelector('.input-radio')?.textContent.trim();const input=label.querySelector('input[type="radio"]');
        if(!/^[A-E]$/.test(letter||'')||!input||options.has(letter))throw Error(`第 ${number} 题选项结构异常`);
        options.set(letter,{input,label});
      }
      if(options.size<4||options.size>5)throw Error(`第 ${number} 题没有可用的单选选项`);
      map.set(number,{number,el,key:el.getAttribute('data-question-key'),options});
    }
    if(!map.size)throw Error('未找到粉笔单选答题控件。请进入 /ti/exam/exercise/ 答题页并等候加载');
    return map;
  }
  function selected(q){const checked=[...q.options].filter(([,v])=>v.input.checked).map(([k])=>k);if(checked.length>1)throw Error(`第 ${q.number} 题出现多个选中项，停止录入`);return checked[0]||null;}
  function plan(rows,map,overwrite=false){
    const result={write:[],same:[],conflict:[],skip:[],missing:[]};const seen=new Set();
    for(const r of rows){if(!Number.isInteger(r.number)||seen.has(r.number))throw Error('答案题号无效或重复');seen.add(r.number);
      if(!/^[A-E]$/.test(r.answer||'')){result.skip.push(r);continue;}
      const q=map.get(r.number);if(!q||!q.options.has(r.answer)){result.missing.push(r);continue;}
      const before=selected(q);const item={...r,before,key:q.key};
      if(before===r.answer)result.same.push(item);else if(before&&!overwrite)result.conflict.push(item);else result.write.push(item);
    }return result;
  }
  async function apply(rows,{doc,overwrite=false,isCancelled=()=>false,onProgress=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),isCurrent=()=>true}){
    const initial=plan(rows,scan(doc),overwrite);if(initial.missing.length)throw Error('页面缺少题号或选项：'+initial.missing.map(r=>r.number).join('、')+'；未开始写入');
    const done=[];
    for(const r of initial.write){
      if(isCancelled())return{...initial,done,cancelled:true};
      if(!isCurrent())throw Error(`答题页面已变化，已写入 ${done.length} 题后停止`);
      let q=scan(doc).get(r.number);
      if(!q||q.key!==r.key||selected(q)!==r.before)throw Error(`第 ${r.number} 题的页面或答案已变化，已写入 ${done.length} 题后停止`);
      const option=q.options.get(r.answer);if(option.input.disabled||!option.label.isConnected)throw Error(`第 ${r.number} 题不可点击，已写入 ${done.length} 题后停止`);
      // Use the same label click as the site; never set checked or Angular internals.
      option.label.click();
      let verified=false;for(let i=0;i<12;i++){await wait(80);q=scan(doc).get(r.number);if(!isCurrent()||q?.key!==r.key)break;if(selected(q)===r.answer){verified=true;break;}}
      if(!verified)throw Error(`第 ${r.number} 题选中状态未确认，已写入 ${done.length} 题后停止，请核对页面`);
      done.push(r);onProgress(r,done.length,initial.write.length);await wait(80);
    }
    // Recheck all touched answers after the final Angular update.
    const final=scan(doc);for(const r of done)if(final.get(r.number)?.key!==r.key||selected(final.get(r.number))!==r.answer)throw Error(`末次核对第 ${r.number} 题不一致，请检查已写入答案`);
    return{...initial,done,cancelled:false};
  }
  return{normalize,scan,selected,plan,apply};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=FenbiCore;
