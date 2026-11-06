'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {verifyUpdater}=require('../scripts/verify-package.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
test('packaged updater verification rejects changed code, payload, compiler and build flags',()=>{
  const source=Buffer.from('fixture source'),helper=Buffer.from('MZ fixture helper'),buildScript=Buffer.from('fixture build');
  const manifest={schemaVersion:1,source:{name:'updater-helper.cs',sha256:hash(source)},buildScriptSha256:hash(buildScript),output:{name:'ravenshelf-updater.exe',size:helper.length,sha256:hash(helper)},compiler:{name:'csc.exe',relativePath:'Microsoft.NET/Framework64/v4.0.30319/csc.exe',sha256:'a'.repeat(64)},options:['/nologo','/target:winexe','/optimize+','/platform:anycpu','/reference:System.Web.Extensions.dll']};
  const fixture=()=>({source,helper,buildScript,manifest:structuredClone(manifest)});
  assert.doesNotThrow(()=>verifyUpdater(fixture()));
  for(const change of [f=>f.source=Buffer.from('changed source'),f=>f.helper=Buffer.from('MZ changed helper'),f=>f.buildScript=Buffer.from('changed build'),f=>f.manifest.output.size++,f=>f.manifest.compiler.relativePath='C:/private/csc.exe',f=>f.manifest.compiler.sha256='z'.repeat(64),f=>f.manifest.options.push('/debug')]){
    const changed=fixture();change(changed);assert.throws(()=>verifyUpdater(changed));
  }
});
