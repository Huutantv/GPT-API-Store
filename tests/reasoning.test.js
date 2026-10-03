"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "doro_proxy_node.js"), "utf8");
function slice(a,b){ const s=SRC.indexOf(a), e=SRC.indexOf(b); if(s==-1||e==-1) throw new Error(a); return SRC.slice(s,e); }
const ctx={console,process};
vm.createContext(ctx);
const stub = "function sanitizeBackendText(t,b,p){return t;} function sanitizeAssistantIdentityText(t,p,b){return t;} function firstNonEmptyString(...a){for(const v of a) if(typeof v==='string'&&v) return v; return ''; }";
vm.runInContext([stub, slice("function normalizeOpenAIAssistantPayload","function hasOpenAIAssistantOutput"), slice("function hasOpenAIAssistantOutput","async function postWithKeyFailover")].join("\n"), ctx);
const { hasOpenAIAssistantOutput } = ctx;
let pass=0, failures=[];
function check(n,c){ if(c) pass++; else { failures.push(n); console.log("FAIL "+n);} }
check("reasoning-only false", hasOpenAIAssistantOutput({choices:[{message:{role:"assistant", content:"", reasoning_content:"thinking..."}}]})===false);
check("reasoning with content true", hasOpenAIAssistantOutput({choices:[{message:{role:"assistant", content:"hello", reasoning_content:"thinking"}}]})===true);
check("content only true", hasOpenAIAssistantOutput({choices:[{message:{role:"assistant", content:"hello"}}]})===true);
check("tool_calls true", hasOpenAIAssistantOutput({choices:[{message:{role:"assistant", content:"", tool_calls:[{id:"1", function:{name:"test", arguments:"{}"}}]}}]})===true);
check("empty false", hasOpenAIAssistantOutput({choices:[{message:{role:"assistant", content:""}}]})===false);
check("delta reasoning-only false", hasOpenAIAssistantOutput({choices:[{delta:{content:"", reasoning_content:"thinking"}}]})===false);
console.log(`\n${pass} passed, ${failures.length} failed`);
if(failures.length) process.exit(1);
