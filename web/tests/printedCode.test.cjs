const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const coreRoot = path.join(__dirname, '../../shared-core/src');
const cache = new Map();
const document = {createElement: () => ({getContext: () => ({putImageData(){},drawImage(){}}),toDataURL:()=>''})};
function load(file) {
  file = path.resolve(file);
  if(cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file,exports);
  const source = fs.readFileSync(file,'utf8');
  const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(compiled,{exports,document,require:name => {
    if(name==='@pattern-studio/core') return Object.assign({}, ...['types','logic/phash','logic/dmc','logic/progress'].map(p=>load(path.join(coreRoot,p+'.ts'))));
    return load(path.join(path.dirname(file),name+'.ts'));
  }});
  return exports;
}
const {hasPrintedCode} = load(path.join(__dirname,'../src/processing/printedCode.ts'));
const {recognizeSymbols} = load(path.join(__dirname,'../src/processing/symbols.ts'));
const {computeStats} = load(path.join(coreRoot,'logic/progress.ts'));
function image(bg,code=false) {
  const data = new Uint8ClampedArray(24*24*4);
  for(let i=0;i<24*24;i++) data.set([...bg,255],i*4);
  if(code) for(let y=8;y<15;y++) for(let x=11;x<13;x++) data.set([bg[0]<128?240:10,bg[0]<128?240:10,bg[0]<128?240:10,255],(y*24+x)*4);
  return data;
}
test('blank fills of every colour have no printed code',()=>{
  for(const bg of [[255,255,255],[0,0,0],[80,80,80],[255,90,30],[180,160,240]]) assert.equal(hasPrintedCode(image(bg),24,{x:0,y:0,w:24,h:24}),false);
});
test('both dark codes and inverted light codes are tracked',()=>{
  for(const bg of [[255,255,255],[0,0,0],[80,80,80],[255,90,30]]) assert.equal(hasPrintedCode(image(bg,true),24,{x:0,y:0,w:24,h:24}),true);
});
test('uploaded sample: codes are included, enclosed holes and shadows excluded',()=>{
  for(const crop of require('./fixtures/printed-code-crops.json')) assert.equal(hasPrintedCode(new Uint8ClampedArray(crop.pixels),crop.width,{x:0,y:0,w:crop.width,h:crop.height}),crop.expected,'row '+(crop.row+1)+' col '+(crop.col+1));
});
test('enclosed blank cell is excluded from symbols, totals, and completion',()=>{
  const width=72,height=72,data=new Uint8ClampedArray(width*height*4);
  for(let r=0;r<3;r++)for(let c=0;c<3;c++) {
    const cell=image([255,255,255],r!==1||c!==1);
    for(let y=0;y<24;y++)for(let x=0;x<24;x++)data.set(cell.slice((y*24+x)*4,(y*24+x)*4+4),((r*24+y)*width+c*24+x)*4);
  }
  const {grid}=recognizeSymbols({width,height,imageData:{width,height,data}},{rowBoundaries:[0,24,48,72],colBoundaries:[0,24,48,72]});
  assert.equal(grid.cells[4].symbol_id,'bg');
  assert.equal(grid.symbols.reduce((n,s)=>n+s.count,0),8);
  const progress=Object.fromEntries(grid.cells.map(c=>[c.row+':'+c.col,{status:'completed',updated_at:0}]));
  const stats=computeStats(grid,progress);
  assert.equal(stats.total_cells,8);
  assert.equal(stats.completed,8);
  assert.equal(stats.completion,1);
});

test('low-contrast E13 codes on purple remain tracked at multiple sizes',()=>{
  for(const crop of require('./fixtures/e13-crops.json')) {
    const original=new Uint8ClampedArray(crop.pixels);
    for(const scale of [1,0.75,0.5]) {
      const width=Math.round(crop.width*scale),height=Math.round(crop.height*scale);
      const data=new Uint8ClampedArray(width*height*4);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
        const px=Math.min(crop.width-1,Math.floor((x+0.5)/scale));
        const py=Math.min(crop.height-1,Math.floor((y+0.5)/scale));
        const p=(py*crop.width+px)*4;
        data.set(original.slice(p,p+4),(y*width+x)*4);
      }
      assert.equal(hasPrintedCode(data,width,{x:0,y:0,w:width,h:height}),true,'E13 at scale '+scale);
    }
  }
});
test('E13 survives symbol extraction and contributes to the stitch total',()=>{
  const crop=require('./fixtures/e13-crops.json')[0];
  const width=crop.width,height=crop.height,data=new Uint8ClampedArray(crop.pixels);
  const {grid}=recognizeSymbols({width,height,imageData:{width,height,data}},{colBoundaries:[0,width],rowBoundaries:[0,height]});
  assert.notEqual(grid.cells[0].symbol_id,'bg');
  assert.equal(grid.symbols.length,1);
  assert.equal(computeStats(grid,{}).total_cells,1);
});
