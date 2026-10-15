export const FILES=['content/site-editor.json'];
export const COPY_KEYS=["heroEmphasis","portraitLineOne","portraitLineTwo","howEyebrow","howHeading","previewEyebrow","previewHeading","faqEyebrow","faqHeading","ctaEyebrow","ctaLineOne","ctaLineTwo","footerTagline"];
const sameKeys=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&JSON.stringify(Object.keys(object).sort())===JSON.stringify([...keys].sort());
const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
export function validateDocument(source){
 const doc=JSON.parse(source);
 if(!sameKeys(doc,['copy','theme'])||!sameKeys(doc.copy,COPY_KEYS)||!sameKeys(doc.theme,['accent','accentHover']))throw Error('Editor schema is fixed');
 for(const value of Object.values(doc.copy)){
  if(typeof value!=='string'||!value.trim()||value.length>180||/[<>@\\\x00-\x1f]/.test(value)||/https?:|www\.|\b(?:javascript|data):/i.test(value))throw Error('Use short plain marketing text without markup or links');
  if(/\d|[$€£]|\b(?:semaglutide|tirzepatide|medication|dosage|dose|prescription|prescribe|insurance|HIPAA|FDA|cure|guaranteed?|risk.free|side.effects?|eligibility|eligible|licensed|encrypted)\b/i.test(value))throw Error('Clinical, pricing, eligibility and security claims require administrator review');
 }
 for(const [key,color] of Object.entries(doc.theme)){const baseline=key==='accent'?'#b85e43':'#9c4933';if(typeof color!=='string'||!/^#[a-fA-F0-9]{6}$/.test(color)||contrast(color,'#fffdf8')<Math.min(4.5,contrast(baseline,'#fffdf8')))throw Error('Accent colors must retain readable button contrast');}
 return doc;
}
export function validateChange(path,before,after){if(!FILES.includes(path)||typeof after!=='string'||after.length>8000)throw Error('File outside edit policy');validateDocument(after);}
export function validateProposal(proposal,files){if(!proposal||!Array.isArray(proposal.files)||proposal.files.length!==1)throw Error('Invalid proposal');const edit=proposal.files[0];if(!edit||!(edit.path in files)||edit.content===files[edit.path])throw Error('Duplicate, unavailable or unchanged file');validateChange(edit.path,files[edit.path],edit.content);return proposal.files;}
