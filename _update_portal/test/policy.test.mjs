import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{validateDocument,validateChange,validateProposal}from'../policy.mjs';
const path='content/site-editor.json',before=readFileSync(new URL('../../content/site-editor.json',import.meta.url),'utf8');
const edit=fn=>{const d=JSON.parse(before);fn(d);return JSON.stringify(d);};
test('existing public copy and colors satisfy policy',()=>validateDocument(before));
test('marketing headline and readable accent updates pass',()=>{validateChange(path,before,edit(d=>d.copy.heroEmphasis='A simpler next chapter.'));validateChange(path,before,edit(d=>d.theme.accent='#884422'));});
for(const [name,fn]of [
 ['markup',d=>d.copy.heroEmphasis='<script>alert(1)</script>'],['links',d=>d.copy.heroEmphasis='Visit https://evil.example'],
 ['medical claim',d=>d.copy.heroEmphasis='Guaranteed weight loss'],['medication',d=>d.copy.heroEmphasis='Semaglutide for everyone'],
 ['pricing',d=>d.copy.heroEmphasis='Only $99'],['security claim',d=>d.copy.heroEmphasis='HIPAA compliant'],
 ['extra clinical field',d=>d.copy.dosage='new dose'],['schema removal',d=>delete d.copy.faqHeading],
 ['low contrast',d=>d.theme.accent='#ffffff'],['CSS injection',d=>d.theme.accent='red;display:none'],
 ['extra theme property',d=>d.theme.display='none'],['oversize',d=>d.copy.heroEmphasis='x'.repeat(181)],
 ['control characters',d=>d.copy.heroEmphasis='New\u0000heading']
])test('rejects '+name,()=>assert.throws(()=>validateChange(path,before,edit(fn))));
for(const p of ['app/page.tsx','app/globals.css','.github/workflows/deploy-pages.yml','../content/site-editor.json','.env'])test('rejects protected path '+p,()=>assert.throws(()=>validateChange(p,before,before)));
test('empty, duplicate and unchanged proposals are refused',()=>{for(const p of [{files:[]},{files:[{path,content:before}]},{files:[{path,content:before},{path,content:before}]}])assert.throws(()=>validateProposal(p,{[path]:before}));});
