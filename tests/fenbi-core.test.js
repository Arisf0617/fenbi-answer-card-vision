const assert = require('node:assert/strict');
const core = require('../fenbi-core.js');

function makeDoc(questionCount=3) {
  const questions=[];
  for(let n=1;n<=questionCount;n++) {
    const options=new Map('ABCD'.split('').map(letter=>[letter,{checked:false,disabled:false,click(){for(const o of options.values())o.checked=false;this.checked=true;}}]));
    questions.push({number:n,key:`key-${n}`,options});
  }
  return {questions,querySelectorAll(){return questions.map(q=>({
    getAttribute(){return q.key;},
    querySelector(sel){if(sel==='.title-index')return{textContent:`${q.number}.`};if(sel==='.title-type-name')return{textContent:'单选题'};return null;},
    querySelectorAll(){return[...q.options].map(([letter,o])=>({querySelector(sel){return sel==='.input-radio'?{textContent:letter}:sel==='input[type="radio"]'?o:null;},isConnected:true,click(){o.click();}}));}
  }));}};
}

(async()=>{
  const doc=makeDoc(),map=core.scan(doc);
  assert.equal(map.size,3);
  const rows=[{number:1,answer:'A'},{number:2,answer:'?'},{number:3,answer:'C'}];
  map.get(1).options.get('B').input.checked=true;
  const p=core.plan(rows,map,false);
  assert.deepEqual(p.write.map(x=>x.number),[3]);
  assert.deepEqual(p.conflict.map(x=>x.number),[1]);
  assert.deepEqual(p.skip.map(x=>x.number),[2]);
  const result=await core.apply(rows,{doc,overwrite:false,isCancelled:()=>false,isCurrent:()=>true,onProgress(){},wait:async()=>{}});
  assert.equal(result.done.length,1);
  assert.equal(core.selected(core.scan(doc).get(3)),'C');
  const overwrite=await core.apply([{number:1,answer:'A'}],{doc,overwrite:true,isCancelled:()=>false,isCurrent:()=>true,onProgress(){},wait:async()=>{}});
  assert.equal(overwrite.done.length,1);
  assert.equal(core.selected(core.scan(doc).get(1)),'A');
  await assert.rejects(core.apply([{number:1,answer:'D'}],{doc,overwrite:true,isCancelled:()=>false,isCurrent:()=>false,onProgress(){},wait:async()=>{}}),/页面已变化/);
  console.log('粉笔题号映射、冲突跳过、空题跳过、覆盖写入和页面变化中止均通过');
})().catch(e=>{console.error(e);process.exit(1);});
