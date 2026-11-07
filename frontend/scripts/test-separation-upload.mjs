import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
const source = ts.transpileModule(fs.readFileSync('src/lib/separation-upload.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function run(replies, outcome) {
 let requests=0, uploads=0, progress=[];
 const result={task_id:'same-task',filename:'song.wav',status:'queued'};
 class XHR {
  upload={};status=202;responseText=JSON.stringify(result);
  open(){} setRequestHeader(){}
  send(form){uploads++;assert.equal(form.get('request_id'),'request-id');queueMicrotask(()=>{this.upload.onprogress({lengthComputable:true,loaded:50,total:100});if(outcome==='network')this.onerror();else if(outcome==='quota'){this.status=413;this.responseText=JSON.stringify({detail:'Cloud full'});this.onload();}else this.onload();});}
 }
 const exports={};
 vm.runInNewContext(source,{exports,require:(name)=>name==='@/lib/api'?{apiFetch:async()=>{requests++;let task=replies.shift();return{ok:true,json:async()=>({task})};}}:{clientLocale:()=> 'en',translateClient:s=>s},Headers,AbortSignal,XMLHttpRequest:XHR,FormData,Error,Promise});
 try{return{value:await exports.queueSeparation(new FormData(),'request-id',p=>progress.push(p)),requests,uploads,progress};}
 catch(error){return{error,requests,uploads,progress};}
}
(async()=>{
 let x=await run([{task_id:'existing'}]);assert.equal(x.value.task_id,'existing');assert.equal(x.uploads,0);
 x=await run([null]);assert.equal(x.value.task_id,'same-task');assert.equal(x.progress[0],50);assert.equal(x.uploads,1);
 x=await run([null,{task_id:'recovered'}],'network');assert.equal(x.value.task_id,'recovered');assert.equal(x.requests,2);assert.equal(x.uploads,1);
 x=await run([null,null],'network');assert.match(x.error.message,/การเชื่อมต่อขาดช่วง/);assert.equal(x.uploads,1);
 x=await run([null],'quota');assert.equal(x.error.message,'Cloud full');assert.equal(x.requests,1);
 console.log('5 upload/recovery/progress/error scenarios passed');
})().catch(e=>{console.error(e);process.exit(1)});
