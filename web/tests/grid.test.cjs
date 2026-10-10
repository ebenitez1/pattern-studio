const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/processing/grid.ts'), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const context = {exports:{}, require:() => ({})};
vm.runInNewContext(compiled, context);
const {estimatePitch, combBoundaries} = context.exports;
function signal(alternate) {
  const values = new Float64Array(800);
  for(let x=5, cell=0;x<800;x+=20,cell++) {
    for(let d=-1;d<=1;d++) values[x+d]=100*(cell%2 ? alternate : 1);
  }
  return values;
}
test('printed text halfway between boundaries does not double the columns', () => {
  assert.equal(estimatePitch(signal(0.78),5,150),40);
});
test('checker texture halfway between boundaries does not double the grid', () => {
  assert.equal(estimatePitch(signal(0.6),5,150),40);
});
test('real grid lines with varying strength keep their original pitch', () => {
  for(const strength of [0.86,0.9,1]) assert.equal(estimatePitch(signal(strength),5,150),20);
});
test('uploaded chart edge profiles retain square cells', () => {
  const profiles = require('./fixtures/chart-edges.json');
  assert.equal(combBoundaries(new Float64Array(profiles.colScore),803).pitch,40);
  assert.equal(combBoundaries(new Float64Array(profiles.rowScore),821).pitch,40);
});
