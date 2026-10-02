const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('docs/auth-email.js','utf8');
function setup(available=true){
 const nodes=new Map();const node=k=>{if(!nodes.has(k))nodes.set(k,{value:'',hidden:false,disabled:false,required:false,textContent:'',addEventListener(t,f){this[t]=f;},checkValidity(){return this.value.includes('@');},reportValidity(){this.invalid=true;},focus(){this.focused=true;}});return nodes.get(k);};
 const root=node('root');root.querySelector=node;
 let listener; const sends=[],checks=[];let sendResult={error:null},verifyResult={data:{session:{user:{id:'one'}}},error:null};
 const client={auth:{onAuthStateChange(fn){listener=fn;},async signInWithOtp(args){sends.push(args);return await sendResult;},async verifyOtp(args){checks.push(args);return await verifyResult;}}};
 vm.runInNewContext(source,{document:{querySelector:()=>root},window:{HubClient:available?client:null},Date,Math,Error});
 return {node,root,sends,checks,submit:()=>node('form').submit({preventDefault(){}}),event:user=>listener('SIGNED_IN',{user}),sendResult:v=>sendResult=v,verifyResult:v=>verifyResult=v};
}
async function request(s){s.node('[data-email-address]').value='player@example.com';await s.submit();}
test('email request and verification use distinct APIs and same address',async()=>{
 const s=setup();await request(s);assert.equal(s.sends[0].email,'player@example.com');assert.equal(s.sends[0].options.shouldCreateUser,true);assert.equal(s.node('[data-email-code-panel]').hidden,false);
 s.node('[data-email-code]').value='123456';await s.submit();assert.equal(s.checks[0].type,'email');assert.equal(s.checks[0].token,'123456');assert.equal(s.checks[0].email,'player@example.com');assert.equal(s.root.hidden,true);assert.equal(s.node('[data-email-code]').value,'');
});
test('invalid address and malformed code never reach server',async()=>{
 const s=setup();await s.submit();assert.equal(s.sends.length,0);await request(s);s.node('[data-email-code]').value='bad';await s.submit();assert.equal(s.checks.length,0);
});
test('failed send recovers controls without revealing account existence',async()=>{
 const s=setup();s.sendResult({error:{message:'User does not exist'}});await request(s);assert.equal(s.node('[data-email-submit]').disabled,false);assert.match(s.node('[data-email-status]').textContent,/Не удалось отправить/);assert.doesNotMatch(s.node('[data-email-status]').textContent,/exist/);
});
test('wrong or expired code stays signed out and permits retry',async()=>{
 const s=setup();await request(s);s.verifyResult({error:{message:'expired'}});s.node('[data-email-code]').value='123456';await s.submit();assert.equal(s.root.hidden,false);assert.equal(s.node('[data-email-submit]').disabled,false);assert.equal(s.node('[data-email-code]').value,'');assert.match(s.node('[data-email-status]').textContent,/Не удалось проверить/);
});
test('resend cooldown survives changing address',async()=>{
 const s=setup();await request(s);await s.node('[data-email-resend]').click();assert.equal(s.sends.length,1);s.node('[data-email-change]').click();s.node('[data-email-address]').value='other@example.com';await s.submit();assert.equal(s.sends.length,1);assert.match(s.node('[data-email-status]').textContent,/Подождите/);
});
test('duplicate submit while sending makes one request',async()=>{
 const s=setup();let done;s.sendResult(new Promise(r=>done=r));const pending=request(s);await s.submit();assert.equal(s.sends.length,1);done({error:null});await pending;
});
test('Google or another-tab sign-in invalidates pending email UI',async()=>{
 const s=setup();let done;s.sendResult(new Promise(r=>done=r));const pending=request(s);s.event({id:'google'});done({error:null});await pending;assert.equal(s.root.hidden,true);assert.equal(s.node('[data-email-code-panel]').hidden,true);assert.equal(s.node('[data-email-address]').value,'');s.event(null);assert.equal(s.root.hidden,false);
});
test('missing auth SDK disables submission',()=>{
 const s=setup(false);assert.equal(s.node('[data-email-submit]').disabled,true);assert.match(s.node('[data-email-status]').textContent,/недоступен/);
});
