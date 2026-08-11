// Sonda 3 — conformidad con los tokens (escala, radios, rejilla, familias,
// pesos, paleta) y alineación de hermanos.
//
// OJO: esta sonda mide CONFORMIDAD, no SIGNIFICADO. Puede dar cero con
// --emo-ira siendo un duplicado hex exacto de --neg, o con --text-3 (token
// de TEXTO) usado como relleno de datos. Para el significado hacen falta
// probe-state.js y probe-encoding.js.
(()=>{
const o={};const de=document.documentElement;const cs0=getComputedStyle(de);
const tok={};
for(const sh of document.styleSheets){let rs;try{rs=sh.cssRules}catch(e){continue}
  for(const r of rs||[]){if(r.style&&r.selectorText&&/:root/.test(r.selectorText)){
    for(const p of r.style)if(p.startsWith('--'))tok[p]=cs0.getPropertyValue(p).trim()}}}
const probe=document.createElement('div');probe.style.position='absolute';
probe.style.visibility='hidden';document.body.appendChild(probe);
// clamp()/calc() hay que RESOLVERLO en el viewport actual: leer sólo valores px
// literales dejaba fuera los tokens fluidos y los contaba como fuera de escala.
const numTok=(pre,prop,read)=>{const s=new Set();
  for(const k in tok){if(!k.startsWith(pre))continue;
    const m=tok[k].match(/^([\d.]+)px$/);
    if(m){s.add(Math.round(parseFloat(m[1])*100)/100);continue}
    probe.style.cssText='position:absolute;visibility:hidden;width:200px;'+prop+':'+tok[k];
    const cm=String(getComputedStyle(probe)[read]).match(/^([\d.]+)px$/);
    if(cm)s.add(Math.round(parseFloat(cm[1])*100)/100)}
  return s};
o.fsTok=[...numTok('--fs-','font-size','fontSize')].sort((a,b)=>a-b);
o.rTok=[...numTok('--r-','border-radius','borderTopLeftRadius')].sort((a,b)=>a-b);
const px=(v)=>{const d=document.createElement('div');d.style.background=v;
  document.body.appendChild(d);const c=getComputedStyle(d).backgroundColor;d.remove();return c};
const pal={};for(const k in tok){const v=tok[k];if(/^#|^rgb/.test(v)){
  const c=px(v);if(/^rgb/.test(c))pal[c]=(pal[c]?pal[c]+','+k:k)}}
o.palSize=Object.keys(pal).length;
const vis=(el)=>{const c=getComputedStyle(el);
  if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)<0.05)return null;
  const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return null;return c};
const own=(el)=>{let t='';for(const n of el.childNodes)if(n.nodeType===3)t+=n.textContent;return t.trim()};
const tag=(el)=>el.tagName.toLowerCase()+((typeof el.className==='string'&&el.className.trim())
  ?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):'');
const top=(x,n)=>Object.entries(x).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>k+' x'+v);
const sum=(x)=>Object.values(x).reduce((a,b)=>a+b,0);
const fsOff={},rOff={},gapOdd={},D={ff:{},fw:{},rad:{},sh:{}},colOff={};
let colTotal=0;
for(const el of document.querySelectorAll('body *')){
  const c=vis(el);if(!c)continue;
  if(el.closest('.sr-only'))continue;
  // Leaflet trae su propia hoja: no es nuestro sistema.
  if(el.closest('.leaflet-container')||/leaflet/.test(String(el.className)))continue;
  const t=own(el);
  // La nube de palabras se excluye: ahí el tamaño ES el dato (frecuencia), es
  // continuo por diseño, y medirlo contra la escala tipográfica es la vara
  // equivocada.
  if(t.length>1&&!el.closest('.wc-term,.eco-wordcloud')){
    const f=Math.round(parseFloat(c.fontSize)*100)/100;
    if(o.fsTok.length&&!o.fsTok.includes(f))fsOff[f+'px '+tag(el)]=(fsOff[f+'px '+tag(el)]||0)+1;
    const fam=c.fontFamily.split(',')[0].replace(/["']/g,'').trim();
    D.ff[fam]=(D.ff[fam]||0)+1;D.fw[c.fontWeight]=(D.fw[c.fontWeight]||0)+1}
  const mr=c.borderTopLeftRadius.match(/^([\d.]+)px$/);
  if(mr){const v=Math.round(parseFloat(mr[1])*100)/100;
    if(v>0&&v<9990&&o.rTok.length&&!o.rTok.includes(v))rOff[v+'px '+tag(el)]=(rOff[v+'px '+tag(el)]||0)+1}
  if(c.borderTopLeftRadius&&c.borderTopLeftRadius!=='0px')D.rad[c.borderTopLeftRadius]=(D.rad[c.borderTopLeftRadius]||0)+1;
  if(c.boxShadow&&c.boxShadow!=='none')D.sh[c.boxShadow.slice(0,60)]=(D.sh[c.boxShadow.slice(0,60)]||0)+1;
  // Sólo gap/rowGap: un padding impar es como se centra contenido de altura
  // impar en una caja par, no un defecto.
  for(const p of ['gap','rowGap']){const m=String(c[p]).match(/^([\d.]+)px$/);if(!m)continue;
    const v=parseFloat(m[1]);if(v>0&&v%2!==0)gapOdd[v+'px '+p+' '+tag(el)]=(gapOdd[v+'px '+p+' '+tag(el)]||0)+1}
  for(const pv of [['color',c.color],['bg',c.backgroundColor],['bd',c.borderTopColor]]){
    const prop=pv[0],val=pv[1];
    if(!val||val==='rgba(0, 0, 0, 0)'||val==='transparent')continue;
    if(prop==='bd'&&(c.borderTopWidth==='0px'||c.borderTopStyle==='none'))continue;
    if(prop==='color'&&own(el).length<2)continue;
    colTotal++;
    const m=val.match(/^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/);if(!m)continue;
    const solid='rgb('+m[1]+', '+m[2]+', '+m[3]+')';
    const alpha=m[4]?parseFloat(m[4]):1;
    if(pal[solid])continue;
    if(alpha<1)continue;                              // mezclas y velos: legítimos
    if(solid==='rgb(255, 255, 255)'||solid==='rgb(0, 0, 0)')continue;
    colOff[prop+' '+solid+' '+tag(el)]=(colOff[prop+' '+solid+' '+tag(el)]||0)+1}}
// Alineación: bordes izquierdos de hermanos que difieren MUY poco. Un desfase
// grande es una sangría deliberada; uno de 1-5px es un error. Se salta el
// interior de los <svg>: el bounding box de un <path> no es maquetación.
const mis=[];
for(const el of document.querySelectorAll('body *')){
  if(el.closest('svg'))continue;
  const c=vis(el);if(!c)continue;
  const kids=[...el.children].filter(k=>{const kc=vis(k);
    return kc&&kc.position!=='absolute'&&kc.position!=='fixed'&&kc.float==='none'});
  if(kids.length<3)continue;
  if(!(c.display==='block'||(/flex/.test(c.display)&&/column/.test(c.flexDirection))))continue;
  const u=[...new Set(kids.map(k=>Math.round(k.getBoundingClientRect().left*10)/10))];
  if(u.length<2||u.length>4)continue;
  const spread=Math.max(...u)-Math.min(...u);
  if(spread>0.6&&spread<=5)mis.push({el:tag(el),lefts:u.join('/'),spread:Math.round(spread*10)/10})}
// Cifras sin ancho fijo en columnas repetidas. Una familia monoespaciada YA
// tiene dígitos de ancho fijo: pedirle tabular-nums no aporta nada.
const clsN={};
for(const el of document.querySelectorAll('body *')){
  if(typeof el.className!=='string')continue;const k=el.className.trim();if(k)clsN[k]=(clsN[k]||0)+1}
let jit=0;
for(const el of document.querySelectorAll('body *')){
  const c=vis(el);if(!c)continue;const t=own(el);
  if(!/^[-+]?[\d][\d.,\s]*%?$/.test(t)||t.length<2)continue;
  const k=typeof el.className==='string'?el.className.trim():'';
  if(!(k&&clsN[k]>=3))continue;
  if(/mono|courier|consolas/i.test(c.fontFamily))continue;
  if(/tabular/.test(c.fontVariantNumeric||'')||/tnum/.test(c.fontFeatureSettings||''))continue;
  jit++}
probe.remove();
o.fsOff=sum(fsOff);o.fsOffTop=top(fsOff,10);
o.rOff=sum(rOff);o.rOffTop=top(rOff,8);
o.gapOdd=sum(gapOdd);o.gapOddTop=top(gapOdd,8);
o.misalign=mis.length;o.misalignTop=mis.slice(0,8);
o.jitterCol=jit;
o.ff=Object.keys(D.ff).length;o.ffTop=top(D.ff,6);
o.fw=Object.keys(D.fw).length;o.fwTop=top(D.fw,8);
o.rad=Object.keys(D.rad).length;o.sh=Object.keys(D.sh).length;
o.colOff=sum(colOff);o.colOffTop=top(colOff,10);o.colTotal=colTotal;
return o})()
