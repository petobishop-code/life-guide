#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const fixtureArg = process.argv.find(v => v.startsWith('--fixture='));

function decodeEntities(t){return t.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
function htmlToText(h){return decodeEntities(h.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();}
function compact(t){return t.toLowerCase().replace(/[\s·_\-–—()[\]{}.,/\\]/g,'');}
async function loadSource(url){
  if(fixtureArg) return fs.readFileSync(path.resolve(ROOT,fixtureArg.split('=')[1]),'utf8');
  const r=await fetch(url,{headers:{'user-agent':'LifeGuideWeddingUpdater/2.0 (+https://www.life-guide.co.kr/)'},signal:AbortSignal.timeout(30000)});
  if(!r.ok) throw new Error(`일정 페이지 응답 오류: HTTP ${r.status}`);
  return await r.text();
}
function findEvent(sourceText,event){
  const dateRegex=/20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}\s*\([^)]*\)\s*[-~–]\s*20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}\s*\([^)]*\)/;
  const positions=[];
  let from=0;
  while(true){
    const i=sourceText.indexOf(event.matchPhrase,from);
    if(i<0) break;
    positions.push(i); from=i+event.matchPhrase.length;
  }
  if(!positions.length) throw new Error('지정 행사명을 찾지 못했습니다');
  const candidates=positions.map(i=>{const block=sourceText.slice(i,i+650);const m=block.match(dateRegex);return m?{i,block,m,distance:m.index}:null;}).filter(Boolean);
  if(!candidates.length) throw new Error('행사명 근처에서 날짜를 찾지 못했습니다');
  candidates.sort((a,b)=>a.distance-b.distance || a.i-b.i);
  const best=candidates[0];
  // 행사명 바로 뒤에 가장 가까운 날짜가 붙은 항목을 선택합니다.
  if(best.distance>260) throw new Error('행사명과 날짜의 거리가 너무 멉니다');
  const block=best.block;
  const m=best.m;
  const parts=[...m[0].matchAll(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})\s*\(([^)]*)\)/g)];
  if(parts.length!==2) throw new Error('날짜 형식을 해석할 수 없습니다');
  const [a,b]=parts;
  const dateDisplay=`${a[1]}년 ${Number(a[2])}월 ${Number(a[3])}일(${a[4]})~${Number(b[2])}월 ${Number(b[3])}일(${b[4]})`;
  let venue=block.slice(m.index+m[0].length).split(/무료초대권|신청하기|자세히/)[0].replace(/^[-:|\s]+/,'').trim();
  if(!venue||venue.length>140) venue=event.fallbackVenue;
  return {dateDisplay,venue};
}
function replaceMarker(content,marker,replacement){
  const start=`<!-- AUTO_EVENT:${marker}:start -->`, end=`<!-- AUTO_EVENT:${marker}:end -->`;
  const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const p=new RegExp(`${esc(start)}[\\s\\S]*?${esc(end)}`);
  if(!p.test(content)) throw new Error(`HTML 마커 없음: ${marker}`);
  return content.replace(p,`${start}\n${replacement}\n${end}`);
}
function updateFile(rel,fn){const f=path.resolve(ROOT,rel),before=fs.readFileSync(f,'utf8'),after=fn(before);if(before===after)return false;if(!dryRun)fs.writeFileSync(f,after,'utf8');console.log(`${dryRun?'[DRY-RUN] ':''}수정: ${rel}`);return true;}
(async()=>{
  const cfg=JSON.parse(fs.readFileSync(path.resolve(ROOT,'config/wedding-events.json'),'utf8'));
  const sourceText=htmlToText(await loadSource(cfg.sourceUrl));
  const checked=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric'}).format(new Date());
  let changed=false, success=0, failures=[];
  for(const event of cfg.events){
    try{
      const d=findEvent(sourceText,event); success++;
      console.log(`✓ ${event.displayName}: ${d.dateDisplay} / ${d.venue}`);
      changed=updateFile(event.detailFile,c=>{
        c=replaceMarker(c,`${event.id}:date`,`        <strong>${d.dateDisplay}</strong>`);
        c=replaceMarker(c,`${event.id}:venue`,`        <strong>${d.venue}</strong>`);
        c=replaceMarker(c,`${event.id}:checked`,`마지막 일정 확인: ${checked}`); return c;
      })||changed;
      changed=updateFile(event.listingFile,c=>replaceMarker(c,`${event.id}:list`,`          <div class="fair-date">${d.dateDisplay}</div>\n          <p>${d.venue}</p>`))||changed;
    }catch(e){failures.push(`${event.displayName}: ${e.message}`);console.error(`⚠ ${event.displayName}: ${e.message} — 기존 HTML 유지`);}
  }
  console.log(`\n성공 ${success}개 / 보류 ${failures.length}개`);
  if(failures.length) console.log(failures.map(x=>`- ${x}`).join('\n'));
  if(success===0) throw new Error('모든 행사 수집에 실패하여 작업을 중단합니다');
  console.log(changed?'일정 변경사항이 있습니다.':'변경된 일정이 없습니다.');
})().catch(e=>{console.error(`\n자동 업데이트 실패: ${e.message}`);process.exit(1);});
