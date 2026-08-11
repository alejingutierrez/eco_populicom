// Sonda 1 — accesibilidad y contención del texto.
// Mide: contraste de TEXTO contra su fondo efectivo (AA), objetivos táctiles
// (24x24 = AA SC 2.5.8; 44x44 = AAA SC 2.5.5), desborde horizontal, corte de
// texto, y paths SVG con NaN.
(()=>{
const o={crash:0,hOv:0,small44:0,small24:0,lowC:0,clip:0,nan:0};
const de=document.documentElement;
// Un crash atrapado por el error boundary hace que TODAS las demás cifras
// mejoren, porque no hay pantalla que medir: al aplicar los parches, small44
// del Scorecard cayó de 190 a 2 y eso se leyó como éxito cuando en realidad la
// vista no renderizaba. Si crash no es 0, el resto de la medición no vale.
if(document.querySelector('[role="alert"]')&&/Algo fall|No se pudo mostrar/.test(document.body.innerText)){
  o.crash=1;
  const d=document.querySelector('details');
  if(d){d.open=true;o.crashStack=(d.innerText||'').split('\n').slice(1,3).join(' ').slice(0,180)}
  return o}
o.hOv=de.scrollWidth-de.clientWidth;
const pc=(s)=>{const d=document.createElement('div');d.style.color=s;document.body.appendChild(d);
  const m=getComputedStyle(d).color.match(/rgba?\(([^)]+)\)/);d.remove();if(!m)return null;
  const p=m[1].split(',').map(Number);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}};
const lin=(c)=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4)};
const lum=(c)=>.2126*lin(c.r)+.7152*lin(c.g)+.0722*lin(c.b);
const cr=(a,b)=>{const x=lum(a),y=lum(b),h=Math.max(x,y),l=Math.min(x,y);return (h+.05)/(l+.05)};
// El fondo efectivo hay que SUBIRLO por los ancestros, y además leer el primer
// stop de un gradiente: mirar sólo backgroundColor daba falsos negativos con
// texto blanco sobre gradiente.
const ebg=(el)=>{let n=el;while(n&&n!==de){const cs=getComputedStyle(n);
  const b=pc(cs.backgroundColor);if(b&&b.a>.5)return b;
  const bi=cs.backgroundImage;
  if(bi&&bi!=='none'&&/gradient/.test(bi)){const m=bi.match(/rgba?\([^)]+\)/);
    if(m){const g=pc(m[0]);if(g&&g.a>.5)return g}}
  n=n.parentElement}
  return pc(getComputedStyle(document.body).backgroundColor)||{r:0,g:0,b:0,a:1}};
o.lowCList=[];o.smallList=[];
const seenT=new Set(),seenS=new Set();
for(const el of document.querySelectorAll('button,a,[role="button"],input,select,textarea,.chip')){
  const r=el.getBoundingClientRect();if(r.width===0||r.height===0)continue;
  // .touch-target amplía el área con ::after: si el pseudo llega a 44, cumple.
  if(el.classList&&el.classList.contains('touch-target')){
    const a=getComputedStyle(el,'::after');
    if((parseFloat(a.width)||0)>=44&&(parseFloat(a.height)||0)>=44)continue}
  const cls=(typeof el.className==='string'&&el.className.trim())
    ?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):'';
  const k=el.tagName.toLowerCase()+cls+'|'+Math.round(r.width)+'x'+Math.round(r.height);
  if(r.width<24||r.height<24)o.small24++;
  if(r.width<44||r.height<44){o.small44++;if(!seenS.has(k)){seenS.add(k);o.smallList.push(k)}}}
for(const el of document.querySelectorAll('body *')){
  let has=false;for(const n of el.childNodes)if(n.nodeType===3&&n.textContent.trim().length>1){has=true;break}
  if(!has)continue;
  const cs=getComputedStyle(el);
  if(cs.visibility==='hidden'||cs.display==='none'||Number(cs.opacity)<.15)continue;
  const fg=pc(cs.color);if(!fg)continue;
  let ratio=cr(fg,ebg(el));
  if(fg.a<1)ratio=ratio/Math.max(.2,fg.a);
  const fs=parseFloat(cs.fontSize),bold=Number(cs.fontWeight)>=700;
  const large=fs>=24||(fs>=18.66&&bold);
  if(ratio<(large?3:4.5)){
    const t=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').slice(0,30);
    const k=cs.color+'|'+Math.round(fs)+'|'+t.slice(0,16);
    if(seenT.has(k))continue;seenT.add(k);
    o.lowC++;o.lowCList.push({t,color:cs.color,ratio:Math.round(ratio*100)/100,size:fs})}}
// Corte SILENCIOSO: overflow oculto SIN ellipsis ni line-clamp. Truncar con
// puntos suspensivos es convención y no se cuenta.
for(const el of document.querySelectorAll('body *')){
  if(el.children.length>2)continue;
  if(el.closest('.sr-only'))continue;
  if(/leaflet/.test(String(el.className)))continue;
  const cs=getComputedStyle(el);
  if(cs.overflow!=='hidden'&&cs.textOverflow!=='ellipsis')continue;
  if(el.scrollWidth<=el.clientWidth+1||el.clientWidth<=0)continue;
  if(cs.textOverflow==='ellipsis'||cs.webkitLineClamp!=='none')continue;
  o.clip++}
for(const el of document.querySelectorAll('path,circle,rect,line,text')){
  for(const a of ['d','cx','cy','x','y','x1','y1','x2','y2','width','height','r']){
    const v=el.getAttribute(a);if(v&&/NaN|Infinity/.test(v)){o.nan++;break}}}
o.lowCList=o.lowCList.slice(0,10);o.smallList=o.smallList.slice(0,10);
return o})()
