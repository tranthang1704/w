'use strict';
const fs=require('fs'), path=require('path');
const root=process.argv[2];
if(!root) throw new Error('Usage: node add-board-studio.js <extracted-app-dir>');
const dashPath=path.join(root,'public','dashboard.js');
const indexPath=path.join(root,'public','index.html');
const widgetPath=path.join(root,'public','widget.js');
const serverPath=path.join(root,'server.js');

let d=fs.readFileSync(dashPath,'utf8');
let h=fs.readFileSync(indexPath,'utf8');
let w=fs.readFileSync(widgetPath,'utf8');
let s=fs.readFileSync(serverPath,'utf8');

function rep(t,a,b,label){ if(!t.includes(a)) throw new Error('Missing anchor '+label); return t.replace(a,b); }

// Persist custom CSS with the normal auction config.
s=rep(s,
"    showVouches: true,\n    showMinEntry: true,\n    showSnipeDelay: true",
"    showVouches: true,\n    showMinEntry: true,\n    showSnipeDelay: true,\n    boardCustomCss: ''",
'server boardCustomCss default');

// Add custom CSS to dashboard config payload.
if (!d.includes("config.boardCustomCss = strVal('inputBoardCustomCss'")) {
  const panelLine = "    config.panelColor = strVal('inputPanelColor', 'default');";
  if (!d.includes(panelLine)) throw new Error('Missing anchor dashboard save css');
  d = d.replace(panelLine, panelLine + "\n    config.boardCustomCss = strVal('inputBoardCustomCss', '').slice(0, 30000);");
}

// Sync textarea from state.
d=rep(d,
"      const inputPanelColor = document.getElementById('inputPanelColor');",
"      const inputBoardCustomCss = document.getElementById('inputBoardCustomCss');\n      if (inputBoardCustomCss && state.config.boardCustomCss !== undefined && document.activeElement !== inputBoardCustomCss) {\n        inputBoardCustomCss.value = state.config.boardCustomCss || '';\n      }\n\n      const inputPanelColor = document.getElementById('inputPanelColor');",
'dashboard sync css');

// Make designer available for every board, including RCKZ.
d=d.replace(
"selectBoardTemplate.value === 'widget3' || selectBoardTemplate.value === 'widget2'",
"selectBoardTemplate.value === 'widget3' || selectBoardTemplate.value === 'widget2' || selectBoardTemplate.value === 'rckz'"
);

// Add board studio panel after template selector block.
const anchor="        <!-- Display Options (Show/Hide Overlay Elements) -->";
const panel=`        <!-- ALL BOARD STUDIO -->\n        <div id="allBoardStudio" style="padding:15px;border-bottom:1px solid rgba(255,255,255,.1);background:rgba(15,23,42,.55);">\n          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">\n            <div>\n              <div style="font-size:13px;font-weight:900;color:#67e8f9;text-transform:uppercase;">ALL BOARD STUDIO</div>\n              <div style="font-size:11px;color:#64748b;">Chỉnh tất cả board trong cùng app. Dùng widget.html làm Browser Source.</div>\n            </div>\n            <button type="button" id="btnBoardStudioPreview" class="btn-secondary">PREVIEW SELECTED</button>\n          </div>\n          <div id="boardStudioButtons" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-bottom:10px;">\n            <button type="button" data-board="none" class="btn-secondary">Classic</button>\n            <button type="button" data-board="host_avatar" class="btn-secondary">Host Avatar</button>\n            <button type="button" data-board="custom" class="btn-secondary">Custom Image</button>\n            <button type="button" data-board="pinky" class="btn-secondary">Pinky</button>\n            <button type="button" data-board="neon" class="btn-secondary">Neon</button>\n            <button type="button" data-board="14alls" class="btn-secondary">14ALLS</button>\n            <button type="button" data-board="widget2" class="btn-secondary">Widget 2</button>\n            <button type="button" data-board="widget3" class="btn-secondary">Ocean / Widget 3</button>\n            <button type="button" data-board="rckz" class="btn-secondary">RCKZ</button>\n          </div>\n          <label style="display:block;font-size:11px;font-weight:800;color:#94a3b8;margin-bottom:6px;">CUSTOM CSS FOR SELECTED/ACTIVE BOARD</label>\n          <textarea id="inputBoardCustomCss" spellcheck="false" placeholder=".digital-timer { font-size: 80px; }" style="width:100%;min-height:120px;background:#020617;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#dbeafe;padding:10px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;"></textarea>\n          <div style="display:flex;gap:8px;margin-top:8px;">\n            <button type="button" id="btnApplyBoardCustomCss" class="btn-control-action" style="flex:1;">APPLY CSS</button>\n            <button type="button" id="btnResetBoardCustomCss" class="btn-secondary" style="flex:1;">RESET CSS</button>\n          </div>\n          <div style="margin-top:9px;font-size:11px;color:#94a3b8;">Browser Source: <code>http://localhost:3000/widget.html</code></div>\n        </div>\n\n`;
if(!h.includes('id="allBoardStudio"')) h=rep(h,anchor,panel+anchor,'all board studio panel');

// Dashboard bindings.
const bindAnchor="// -------------------------------------------------------------\n// Board Template Custom Background";
const bindCode=`// ALL BOARD STUDIO\n(function(){\n  function selectBoard(board){\n    const sel=document.getElementById('selectBoardTemplate');\n    if(!sel) return;\n    sel.value=board;\n    sel.dispatchEvent(new Event('change',{bubbles:true}));\n    if(typeof sendConfigUpdate==='function') sendConfigUpdate();\n    const custom=document.getElementById('customBoardDesigner');\n    if(custom) custom.classList.remove('hidden');\n    const rckz=document.getElementById('rckzCustomizerBox');\n    if(rckz) rckz.style.display=board==='rckz'?'':'none';\n  }\n  document.querySelectorAll('#boardStudioButtons [data-board]').forEach(btn=>btn.addEventListener('click',()=>selectBoard(btn.dataset.board)));\n  const apply=document.getElementById('btnApplyBoardCustomCss');\n  if(apply) apply.addEventListener('click',()=>{ if(typeof sendConfigUpdate==='function') sendConfigUpdate(); });\n  const reset=document.getElementById('btnResetBoardCustomCss');\n  if(reset) reset.addEventListener('click',()=>{ const el=document.getElementById('inputBoardCustomCss'); if(el) el.value=''; if(typeof sendConfigUpdate==='function') sendConfigUpdate(); });\n  const preview=document.getElementById('btnBoardStudioPreview');\n  if(preview) preview.addEventListener('click',()=>{\n    const frame=document.getElementById('previewIframe');\n    if(!frame) return;\n    frame.src='/widget.html?preview=1&_='+Date.now();\n    const custom=document.getElementById('customBoardDesigner');\n    if(custom) custom.classList.remove('hidden');\n  });\n})();\n\n`;
if(!d.includes('// ALL BOARD STUDIO')) {
  if (d.includes(bindAnchor)) d = d.replace(bindAnchor, bindCode + bindAnchor);
  else d += "\n\n" + bindCode;
}

// Apply config CSS to the main widget and same-origin independent board iframes.
const widgetAnchor="// UI Elements\nconst widgetTitle";
const widgetCode=`function applyBoardCustomCss(cssText) {\n  const css=String(cssText||'').slice(0,30000);\n  let style=document.getElementById('boardCustomCssRuntime');\n  if(!style){ style=document.createElement('style'); style.id='boardCustomCssRuntime'; document.head.appendChild(style); }\n  style.textContent=css;\n  ['widget2Frame','widget3Frame','rckzFrame'].forEach(id=>{\n    const frame=document.getElementById(id);\n    if(!frame) return;\n    try {\n      const doc=frame.contentDocument;\n      if(!doc) return;\n      let inner=doc.getElementById('boardCustomCssRuntime');\n      if(!inner){ inner=doc.createElement('style'); inner.id='boardCustomCssRuntime'; doc.head.appendChild(inner); }\n      inner.textContent=css;\n    } catch(_) {}\n  });\n}\nfunction bindBoardFrameCss(frame, cssText){\n  if(!frame || frame.dataset.cssBound==='1') return;\n  frame.dataset.cssBound='1';\n  frame.addEventListener('load',()=>applyBoardCustomCss(cssText));\n}\n\n`;
if(!w.includes('function applyBoardCustomCss')) w=rep(w,widgetAnchor,widgetCode+widgetAnchor,'widget css helper');

// Apply on every state update and bind frames.
w=rep(w,
"socket.on('state_update', (state) => {\n  // Reset cache",
"socket.on('state_update', (state) => {\n  applyBoardCustomCss(state && state.config ? state.config.boardCustomCss : '');\n  // Reset cache",
'state apply css');

w=rep(w,
"      document.body.appendChild(w3frame);",
"      document.body.appendChild(w3frame);\n      bindBoardFrameCss(w3frame, state.config.boardCustomCss || '');",
'widget3 css');
w=rep(w,
"      document.body.appendChild(w2frame);",
"      document.body.appendChild(w2frame);\n      bindBoardFrameCss(w2frame, state.config.boardCustomCss || '');",
'widget2 css');
w=rep(w,
"      document.body.appendChild(rckzframe);",
"      document.body.appendChild(rckzframe);\n      bindBoardFrameCss(rckzframe, state.config.boardCustomCss || '');",
'rckz css');

fs.writeFileSync(dashPath,d);
fs.writeFileSync(indexPath,h);
fs.writeFileSync(widgetPath,w);
fs.writeFileSync(serverPath,s);
console.log('ALL BOARD STUDIO added.');
