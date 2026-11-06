'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const { _test:t }=require('../src/providers.cjs');
const sample=`<article><h1 class="entry-title"><a href="https://fitgirl-repacks.site/example/">Example &amp; DLC</a></h1><time datetime="2026-11-06"></time><div class="entry-content"><h3>#42 Example</h3><p><img class="alignleft" src="https://images.example.org/cover.jpg"><br>Genres/Tags: Action<br>Original Size: <strong>8 GB</strong><br>Repack Size: <strong>3 GB</strong></p><a href="https://fuckingfast.co/abc#Example.part1.rar">part one</a><a href="https://fuckingfast.co/def#Example.part2.rar">part two</a><a href="https://filekeeper.net/abc/Example.part1.rar">mirror</a><div class="su-spoiler"><div class="su-spoiler-title">Game Description</div><div class="su-spoiler-content"><p>A fictional game.</p><script>alert(1)</script><p>Second paragraph.</p></div></div><h3>Repack Features</h3><ul><li>Installation takes 2 minutes</li><li>HDD space: 8 GB</li></ul><h3>Other</h3></div></article><a class="next page-numbers" href="/page/2/">Next</a>`;

test('catalog excludes news, preserves image and size, reports pagination',()=>{
 const result=t.parseListing(sample+'<article><h1 class="entry-title"><a href="/news/">News</a></h1><div class="entry-content">hello</div></article>');
 assert.equal(result.games.length,1);assert.equal(result.games[0].title,'Example & DLC');
 assert.equal(result.games[0].repackSize,'3 GB');assert.equal(result.games[0].originalSize,'8 GB');assert.equal(result.hasMore,true);
 assert.equal(result.games[0].image,'https://images.example.org/cover.jpg');
});
test('detail groups mirrors separately and strips active content from text',()=>{
 const result=t.parseDetail(sample,'https://fitgirl-repacks.site/example/');
 assert.deepEqual(result.groups.map(g=>[g.host,g.urls.length]),[['FuckingFast',2],['FileKeeper',1]]);
 assert.ok(result.description.includes('A fictional game.'));assert.ok(!result.description.includes('alert'));
 assert.match(result.installation,/Installation takes 2 minutes/);
});
test('link extraction deduplicates markdown links without losing fragment keys',()=>{
 assert.deepEqual(t.extractUrls('a https://fuckingfast.co/abc#part1.rar\n[mirror](https://filekeeper.net/xyz/part1.rar) https://fuckingfast.co/abc#part1.rar'),['https://fuckingfast.co/abc#part1.rar','https://filekeeper.net/xyz/part1.rar']);
});
test('FuckingFast parser accepts only its file endpoints',()=>{
 assert.equal(t.parseFastLink(`<script>window.open("https://fuckingfast.co/dl/abc/file.rar")</script>`,'https://fuckingfast.co/abc'),'https://fuckingfast.co/dl/abc/file.rar');
 assert.equal(t.parseFastLink(`<script>window.open("https://evil.example/download.exe")</script>`,'https://fuckingfast.co/abc'),null);
});
test('provider URLs reject credentials and insecure schemes',()=>{
 assert.throws(()=>t.validUrl('https://user:pass@example.org/file'));
 assert.throws(()=>t.validUrl('file:///C:/test'));assert.throws(()=>t.validUrl('http://example.org/file'));
});
test('PrivateBin authenticated decrypt and tamper detection',async()=>{
 const key='11111111111111111111111111111112';const iv=crypto.randomBytes(16),salt=crypto.randomBytes(8);
 const spec=[iv.toString('base64'),salt.toString('base64'),1000,256,128,'aes','gcm','zlib'];const adata=[spec,'markdown',0,0];
 const material=crypto.pbkdf2Sync(t.decodeBase58(key),salt,1000,32,'sha256');
 const cipher=crypto.createCipheriv('aes-256-gcm',material,iv);cipher.setAAD(Buffer.from(JSON.stringify(adata)));
 const input=zlib.deflateRawSync(Buffer.from(JSON.stringify({paste:'https://example.org/file.zip'})));
 const ct=Buffer.concat([cipher.update(input),cipher.final(),cipher.getAuthTag()]);
 const data={status:0,v:2,adata,ct:ct.toString('base64')};
 assert.equal(await t.decryptPaste(data,key),'https://example.org/file.zip');
 ct[0]^=1;await assert.rejects(t.decryptPaste({...data,ct:ct.toString('base64')},key),/could not be decrypted/);
 await assert.rejects(t.decryptPaste({...data,adata:[spec,'markdown',0,1]},key),/Burn-after-reading/);
});
test('page reader rejects unexpectedly large responses',async()=>{
 await assert.rejects(t.limitedText(new Response('0123456789'),5),/size limit/);
});
