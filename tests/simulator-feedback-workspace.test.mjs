import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
const bundled=await build({stdin:{contents:'export * from "./editor/selection-clipboard";export * from "./workspace-session";',resolveDir:fileURLToPath(new URL("../app/simulator/",import.meta.url))},bundle:true,platform:"node",format:"esm",write:false,logLevel:"silent"});
const {copySelection,pasteSelection,parkRecovery,listParkedRecovery}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const component=(id,type,extra={})=>({id,type,label:`${type==="wire-duct"?"WD":type==="contactor380"?"KM":type==="timer380"?"KT":"NO"}1`,position:{x:50,y:80},...extra});
const document={schemaVersion:1,title:"保留接线",lessonId:"motor-course-08",roles:{km:"km"},components:[component("km","contactor380"),component("aux","auxiliary-no",{linkedTo:"km"}),component("timer","timer380",{settings:{delayMs:999}}),component("duct","wire-duct",{size:{width:730,height:44}})],wires:[{id:"internal",from:{componentId:"km",terminalId:"A1"},to:{componentId:"timer",terminalId:"A1"},color:"#abc123",style:"orthogonal",waypoints:[{x:7,y:9}]}]};
test("copy single duct preserves dimensions; group preserves internal wires and remaps associations without roles",()=>{
  const before=JSON.stringify(document);
  const one=pasteSelection(document,copySelection(document,["duct"]));assert.deepEqual(one.document.components.at(-1).size,{width:730,height:44});assert.deepEqual(one.document.components.at(-1).position,{x:82,y:112});
  const result=pasteSelection(document,copySelection(document,["km","aux","timer"]));const added=result.document.components.slice(4);
  assert.equal(added[1].linkedTo,added[0].id);assert.equal(added[2].settings.delayMs,999);assert.equal(result.document.wires.at(-1).from.componentId,added[0].id);assert.deepEqual(result.document.wires.at(-1).waypoints,[{x:39,y:41}]);assert.equal(result.document.wires.at(-1).color,"#abc123");assert.deepEqual(result.document.roles,document.roles);assert.equal(new Set(result.document.components.map(c=>c.id)).size,7);assert.equal(new Set(result.document.components.map(c=>c.label)).size,7);assert.equal(JSON.stringify(document),before);
  const external=pasteSelection(document,copySelection(document,["aux"]));assert.equal(external.clearedLinks,1);assert.equal(external.document.components.at(-1).linkedTo,undefined);assert.equal(external.wireIds.length,0);
});
function storage(){const values=new Map();return{get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};}
test("parked unsaved practice retains draft identity and is isolated by owner; quota and corrupt records preserve data",()=>{
  const store=storage(),state={document,saved:null,dirty:true};
  const a=parkRecovery(store,"owner:a",state);parkRecovery(store,"owner:b",{...state,document:{...document,title:"B"}});
  assert.equal(listParkedRecovery(store,"owner:a").length,1);assert.equal(listParkedRecovery(store,"owner:a")[0].state.document.title,document.title);
  store.setItem("owner:a:parked:1:damaged","bad json");assert.equal(listParkedRecovery(store,"owner:a").some(x=>x.error),true);assert.equal(store.getItem("owner:a:parked:1:damaged"),"bad json");
  const full={getItem:store.getItem,setItem(){throw Error("QuotaExceededError");}};assert.throws(()=>parkRecovery(full,"owner:a",state),/Quota/);assert.equal(store.getItem(a),JSON.stringify(state));
});
