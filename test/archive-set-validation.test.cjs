'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {analyzeArchiveSet}=require('../src/archive-set-validation.cjs');
const part=(number,size=100,prefix='Game')=>({filename:`${prefix}.part${String(number).padStart(2,'0')}.rar`,size});
test('Multipart analysis finds missing earlier/internal parts without claiming a known final part',()=>{
  const result=analyzeArchiveSet([part(1),part(3,40)]);assert.deepEqual(result.groups[0].missing,[2]);assert.equal(result.groups[0].lastPartKnown,false);assert.equal(result.groups[0].complete,null);assert.ok(result.errors.length);assert.match(result.warnings.join(' '),/final part number is unknown/);
  assert.deepEqual(analyzeArchiveSet([part(3)]).groups[0].missing,[1,2]);
});
test('Repeated part numbers and nonfinal size disagreements are reported',()=>{
  assert.deepEqual(analyzeArchiveSet([part(1),{filename:'Game.part1.rar',size:100},part(2)]).groups[0].duplicates,[1]);
  assert.match(analyzeArchiveSet([part(1,100),part(2,90),part(3,30)]).errors.join(' '),/nonfinal/);
  assert.deepEqual(analyzeArchiveSet([part(1,100),part(2,100),part(3,30)]).errors,[]);
});
test('Optional sets stay separate and unrelated bin files are not treated as equal-sized archive volumes',()=>{
  const result=analyzeArchiveSet([part(1),part(2,10),{...part(1,40,'Language'),optional:true},{filename:'fg-01.bin',size:200},{filename:'fg-optional.bin',size:50,optional:true}]);
  assert.equal(result.groups.length,2);assert.equal(result.groups.find(group=>group.name==='Language').optional,true);assert.equal(result.groups.find(group=>group.name==='Game').optional,false);assert.deepEqual(result.errors,[]);
});
test('Numbered 7z and legacy rar volumes are analyzed independently',()=>{
  const result=analyzeArchiveSet([{filename:'Game.7z.001',size:100},{filename:'Game.7z.003',size:5},{filename:'Old.rar',size:100},{filename:'Old.r00',size:100},{filename:'Old.r02',size:5}]);
  assert.deepEqual(result.groups.find(group=>group.pattern==='numbered').missing,[2]);assert.deepEqual(result.groups.find(group=>group.pattern==='legacy-rar').missing,[2]);
});
test('Unresolved names and extreme part numbers never produce a false ready/completeness result',()=>{
  const result=analyzeArchiveSet([{url:'https://example.invalid/no-name'},{filename:'Game.part999999999999999.rar',size:10}]);assert.ok(result.errors.length);assert.match(result.warnings.join(' '),/unresolved/);assert.equal(result.groups.length,0);
  const completeLooking=analyzeArchiveSet([part(1),part(2)]);assert.deepEqual(completeLooking.errors,[]);assert.equal(completeLooking.groups[0].complete,null);
});
