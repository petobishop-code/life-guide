#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const fixtureArg = process.argv.find((v) => v.startsWith('--fixture='));

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function htmlToText(html) {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(text) {
  return text.toLowerCase().replace(/[\s·_\-–—()[\]{}.,/\\]/g, '');
}

async function loadSource(url) {
  if (fixtureArg) {
    const file = path.resolve(ROOT, fixtureArg.split('=')[1]);
    return fs.readFileSync(file, 'utf8');
  }
  const response = await fetch(url, {
    headers: { 'user-agent': 'LifeGuideWeddingUpdater/1.0 (+https://www.life-guide.co.kr/)' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`일정 페이지 응답 오류: HTTP ${response.status}`);
  return await response.text();
}

function findEvent(sourceText, event) {
  const normalizedSource = compact(sourceText);
  const phrase = compact(event.matchPhrase || event.requiredKeywords.join(''));
  const phraseIndex = normalizedSource.indexOf(phrase);
  if (phraseIndex < 0) throw new Error(`${event.id}: 지정 행사명을 찾지 못했습니다.`);
  if (normalizedSource.indexOf(phrase, phraseIndex + phrase.length) >= 0) {
    throw new Error(`${event.id}: 같은 행사명이 2개 이상 발견되었습니다.`);
  }

  const exactIndex = sourceText.indexOf(event.matchPhrase);
  if (exactIndex < 0) throw new Error(`${event.id}: 원문에서 지정 행사명을 찾지 못했습니다.`);
  const secondExactIndex = sourceText.indexOf(event.matchPhrase, exactIndex + event.matchPhrase.length);
  if (secondExactIndex >= 0) throw new Error(`${event.id}: 원문에 같은 행사명이 2개 이상 있습니다.`);
  const block = sourceText.slice(exactIndex, exactIndex + 500);

  const dateRegex = /20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}\s*\([^)]*\)\s*[-~–]\s*20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}\s*\([^)]*\)/;
  const match = block.match(dateRegex);
  if (!match) throw new Error(`${event.id}: 행사 날짜를 찾지 못했습니다.`);

  let venue = block.slice(match.index + match[0].length);
  venue = venue.split(/무료초대권|신청하기/)[0].trim();
  venue = venue.replace(/^[-:|\s]+/, '').trim();
  if (!venue || venue.length > 120) venue = event.fallbackVenue;

  const parts = [...match[0].matchAll(/(20\d{2})[.\/-](\d{1,2})[.\/-](\d{1,2})\s*\(([^)]*)\)/g)];
  if (parts.length !== 2) throw new Error(`${event.id}: 날짜 형식을 해석할 수 없습니다.`);
  const [a,b] = parts;
  const dateDisplay = `${a[1]}년 ${Number(a[2])}월 ${Number(a[3])}일(${a[4]})~${Number(b[2])}월 ${Number(b[3])}일(${b[4]})`;
  return { dateDisplay, venue };
}

function replaceMarker(content, marker, replacement) {
  const start = `<!-- AUTO_EVENT:${marker}:start -->`;
  const end = `<!-- AUTO_EVENT:${marker}:end -->`;
  const pattern = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (!pattern.test(content)) throw new Error(`HTML 마커를 찾지 못했습니다: ${marker}`);
  return content.replace(pattern, `${start}\n${replacement}\n${end}`);
}

function updateFile(relativePath, updater) {
  const file = path.resolve(ROOT, relativePath);
  const before = fs.readFileSync(file, 'utf8');
  const after = updater(before);
  if (before === after) return false;
  if (!dryRun) fs.writeFileSync(file, after, 'utf8');
  console.log(`${dryRun ? '[DRY-RUN] ' : ''}수정: ${relativePath}`);
  return true;
}

(async () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'config/wedding-events.json'), 'utf8'));
  const html = await loadSource(config.sourceUrl);
  const sourceText = htmlToText(html);
  let changed = false;
  const checked = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());

  for (const event of config.events) {
    const data = findEvent(sourceText, event);
    console.log(`${event.id}: ${data.dateDisplay} / ${data.venue}`);

    changed = updateFile(event.detailFile, (content) => {
      content = replaceMarker(content, `${event.id}:date`, `        <strong>${data.dateDisplay}</strong>`);
      content = replaceMarker(content, `${event.id}:venue`, `        <strong>${data.venue}</strong>`);
      content = replaceMarker(content, `${event.id}:checked`, `마지막 일정 확인: ${checked}`);
      return content;
    }) || changed;

    changed = updateFile(event.listingFile, (content) => replaceMarker(
      content,
      `${event.id}:list`,
      `          <div class="fair-date">${data.dateDisplay}</div>\n          <p>${data.venue}</p>`
    )) || changed;
  }

  console.log(changed ? '일정 변경사항이 있습니다.' : '변경된 일정이 없습니다.');
})().catch((error) => {
  console.error(`\n자동 업데이트 실패: ${error.message}`);
  process.exit(1);
});
