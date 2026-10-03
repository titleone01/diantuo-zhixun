import {componentSize,isWireDuct,resolveTerminal} from "../core/catalog";
import type {CircuitDocument,CircuitWire,Point,TerminalRef} from "../core/types";

type Rect=Point&{width:number;height:number};
type Link={to:number;cost:number;points:Point[]};
type Vertex={point:Point;links:Link[]};
type Lane={id:string;rect:Rect;horizontal:boolean;nodes:number[]};
type Network={lanes:Lane[];nodes:Vertex[]};
type Entrance={lane:Lane;point:Point;points:Point[];cost:number};
export type DuctRoute={points?:Point[];reason?:"no-ducts"|"disconnected"};
const cache=new WeakMap<CircuitDocument,{signature:string;network:Network;routes:Map<string,DuctRoute>}>();
const distance=(a:Point,b:Point)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const equal=(a:Point,b:Point)=>a.x===b.x&&a.y===b.y;
function compact(points:Point[]):Point[]{
  const result:Point[]=[];
  for(const point of points){
    if(result.length&&equal(point,result[result.length-1]))continue;
    const a=result.at(-2),b=result.at(-1);
    if(a&&b&&((a.x===b.x&&b.x===point.x&&(b.y-a.y)*(point.y-b.y)>=0)||(a.y===b.y&&b.y===point.y&&(b.x-a.x)*(point.x-b.x)>=0)))result.pop();
    result.push(point);
  }
  return result;
}
function project(lane:Lane,point:Point):Point{
  const r=lane.rect;
  return lane.horizontal?{x:clamp(point.x,r.x,r.x+r.width),y:r.y+r.height/2}:{x:r.x+r.width/2,y:clamp(point.y,r.y,r.y+r.height)};
}
function buildNetwork(document:CircuitDocument):Network{
  const nodes:Vertex[]=[], lanes:Lane[]=document.components.filter(c=>isWireDuct(c.type)).sort((a,b)=>a.id.localeCompare(b.id)).map(c=>({id:c.id,rect:{...c.position,...componentSize(c)},horizontal:c.type==="wire-duct",nodes:[]}));
  const add=(lane:Lane,point:Point)=>{
    const found=lane.nodes.find(index=>equal(nodes[index].point,point));
    if(found!==undefined)return found;
    const index=nodes.length;nodes.push({point,links:[]});lane.nodes.push(index);return index;
  };
  const link=(a:number,b:number,points:Point[])=>{
    const cost=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0);
    nodes[a].links.push({to:b,cost,points});nodes[b].links.push({to:a,cost,points:[...points].reverse()});
  };
  for(const lane of lanes){
    add(lane,project(lane,lane.rect));
    add(lane,project(lane,{x:lane.rect.x+lane.rect.width,y:lane.rect.y+lane.rect.height}));
  }
  for(let i=0;i<lanes.length;i++)for(let j=i+1;j<lanes.length;j++){
    const a=lanes[i],b=lanes[j],left=Math.max(a.rect.x,b.rect.x),right=Math.min(a.rect.x+a.rect.width,b.rect.x+b.rect.width),top=Math.max(a.rect.y,b.rect.y),bottom=Math.min(a.rect.y+a.rect.height,b.rect.y+b.rect.height);
    if(left>right||top>bottom)continue;
    // The connector stays inside the intersection, including touching end caps.
    const joint={x:(left+right)/2,y:(top+bottom)/2},ap=project(a,joint),bp=project(b,joint);
    link(add(a,ap),add(b,bp),compact([ap,joint,bp]));
  }
  for(const lane of lanes){
    lane.nodes.sort((a,b)=>lane.horizontal?nodes[a].point.x-nodes[b].point.x:nodes[a].point.y-nodes[b].point.y);
    for(let i=1;i<lane.nodes.length;i++){const a=lane.nodes[i-1],b=lane.nodes[i];link(a,b,[nodes[a].point,nodes[b].point]);}
  }
  return {lanes,nodes};
}
/** The terminal lead may cross its own artwork; the remaining entrance may not. */
function crossesInterior(a:Point,b:Point,rect:Rect):boolean{
  if(a.x===b.x)return a.x>rect.x&&a.x<rect.x+rect.width&&Math.max(a.y,b.y)>rect.y&&Math.min(a.y,b.y)<rect.y+rect.height;
  if(a.y===b.y)return a.y>rect.y&&a.y<rect.y+rect.height&&Math.max(a.x,b.x)>rect.x&&Math.min(a.x,b.x)<rect.x+rect.width;
  return true;
}
function entrance(document:CircuitDocument,ref:TerminalRef,network:Network):Entrance|undefined{
  const {component,terminal,world}=resolveTerminal(document,ref),size=componentSize(component);
  const rect={...component.position,...size};
  const exit=terminal.side==="top"?{x:world.x,y:component.position.y-12}:terminal.side==="bottom"?{x:world.x,y:component.position.y+size.height+12}:terminal.side==="left"?{x:component.position.x-12,y:world.y}:{x:component.position.x+size.width+12,y:world.y};
  const candidates:Entrance[]=[];
  for(const lane of network.lanes){
    const point=project(lane,exit);
    const corner=terminal.side==="top"||terminal.side==="bottom"?{x:point.x,y:exit.y}:{x:exit.x,y:point.y};
    const alternate=terminal.side==="top"||terminal.side==="bottom"?{x:exit.x,y:point.y}:{x:point.x,y:exit.y};
    // Try either simple elbow, then both outer sides. The first, directed lead
    // is retained even when the nearest duct lies behind the terminal's body.
    const approaches:Point[][]=[[exit,corner,point],[exit,alternate,point]];
    for(const x of [rect.x-12,rect.x+rect.width+12])approaches.push([exit,{x,y:exit.y},{x,y:point.y},point]);
    for(const y of [rect.y-12,rect.y+rect.height+12])approaches.push([exit,{x:exit.x,y},{x:point.x,y},point]);
    for(const approach of approaches){
      if(approach.slice(1).some((next,i)=>crossesInterior(approach[i],next,rect)))continue;
      const points=compact([world,...approach]);
      candidates.push({lane,point,points,cost:points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0)});
    }
  }
  candidates.sort((a,b)=>a.cost-b.cost||a.lane.id.localeCompare(b.lane.id));
  return candidates[0];
}
/** Small binary heap avoids quadratic scans on large duct networks. */
function shortest(network:Network,from:Entrance,to:Entrance):Point[]|undefined{
  const source=network.nodes.length,target=source+1,extra=new Map<number,Link[]>();
  const vertex=(id:number)=>id===source?from.point:id===target?to.point:network.nodes[id].point;
  const add=(a:number,b:number)=>{
    const points=[vertex(a),vertex(b)],cost=distance(points[0],points[1]);
    extra.set(a,[...(extra.get(a)??[]),{to:b,cost,points}]);extra.set(b,[...(extra.get(b)??[]),{to:a,cost,points:[...points].reverse()}]);
  };
  for(const [id,entry] of [[source,from],[target,to]] as const){
    const axis=entry.lane.horizontal?"x":"y", value=entry.point[axis],lane=entry.lane;
    let left=0,right=lane.nodes.length;
    while(left<right){const mid=(left+right)>>>1;if(network.nodes[lane.nodes[mid]].point[axis]<value)left=mid+1;else right=mid;}
    if(left>0)add(id,lane.nodes[left-1]);if(left<lane.nodes.length)add(id,lane.nodes[left]);
  }
  if(from.lane===to.lane)add(source,target);
  const distances=new Map<number,number>([[source,0]]),previous=new Map<number,{from:number;points:Point[]}>(),heap:[number,number][]=[];
  const order=(a:[number,number],b:[number,number])=>a[0]-b[0]||a[1]-b[1];
  const push=(item:[number,number])=>{heap.push(item);let index=heap.length-1;while(index){const parent=(index-1)>>>1;if(order(heap[parent],item)<=0)break;heap[index]=heap[parent];index=parent;}heap[index]=item;};
  const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let index=0;while(index*2+1<heap.length){let child=index*2+1;if(child+1<heap.length&&order(heap[child+1],heap[child])<0)child++;if(order(last,heap[child])<=0)break;heap[index]=heap[child];index=child;}heap[index]=last;}return first;};
  push([0,source]);
  while(heap.length){
    const [cost,id]=pop();if(cost!==distances.get(id))continue;if(id===target)break;
    for(const link of [...(id<source?network.nodes[id].links:[]),...(extra.get(id)??[])]){
      const next=cost+link.cost;if(next>=(distances.get(link.to)??Infinity))continue;
      distances.set(link.to,next);previous.set(link.to,{from:id,points:link.points});push([next,link.to]);
    }
  }
  if(!distances.has(target))return undefined;
  const segments:Point[][]=[];let current=target;
  while(current!==source){const step=previous.get(current)!;segments.push(step.points);current=step.from;}
  return compact(segments.reverse().flat());
}
/** Pure world routing. Geometry never adds an electrical junction or changes wire references. */
export function ductWireRoute(document:CircuitDocument,wire:CircuitWire):DuctRoute{
  const signature=JSON.stringify(document.components.map(c=>[c.id,c.type,c.position,c.size]));
  let saved=cache.get(document);
  if(!saved||saved.signature!==signature){saved={signature,network:buildNetwork(document),routes:new Map()};cache.set(document,saved);}
  const key=JSON.stringify([wire.from,wire.to]);
  const cached=saved.routes.get(key);if(cached)return cached;
  let result:DuctRoute;
  if(!saved.network.lanes.length)result={reason:"no-ducts"};
  else{
    const from=entrance(document,wire.from,saved.network),to=entrance(document,wire.to,saved.network),path=from&&to?shortest(saved.network,from,to):undefined;
    result=path&&from&&to?{points:compact([...from.points,...path,...[...to.points].reverse()])}:{reason:"disconnected"};
  }
  saved.routes.set(key,result);return result;
}
