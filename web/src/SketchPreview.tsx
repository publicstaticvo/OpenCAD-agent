export function SketchPreview({snapshot}:{snapshot:any}){
 const sketch=snapshot.sketch;
 const points=sketch.geometry.flatMap((g:any)=>g.kind==='line'?[g.start,g.end]:[[g.center[0]-g.radius,g.center[1]-g.radius],[g.center[0]+g.radius,g.center[1]+g.radius]]);
 const low=[Math.min(...points.map((p:number[])=>p[0])),Math.min(...points.map((p:number[])=>p[1]))],high=[Math.max(...points.map((p:number[])=>p[0])),Math.max(...points.map((p:number[])=>p[1]))];
 const span=Math.max(high[0]-low[0],high[1]-low[1],1),padding=span*.2;
 return <section className="sketch-snapshot" data-testid="candidate-sketch" data-sequence={snapshot.sequence}>
  <strong>FreeCAD 草图 · {sketch.featureId} · {sketch.fullyConstrained?'完全约束':'未完全约束'}</strong>
  <svg role="img" aria-label="实际 FreeCAD 草图" viewBox={`${low[0]-padding} ${-high[1]-padding} ${high[0]-low[0]+2*padding} ${high[1]-low[1]+2*padding}`}>
   {sketch.geometry.map((g:any)=>g.kind==='line'?<line key={g.index} x1={g.start[0]} y1={-g.start[1]} x2={g.end[0]} y2={-g.end[1]} stroke="#087a9c" strokeWidth={span*.008}/>:<circle key={g.index} cx={g.center[0]} cy={-g.center[1]} r={g.radius} fill="none" stroke="#087a9c" strokeWidth={span*.008}/>)}
  </svg>
  <p>草图位置：[{sketch.placement.base.join(', ')}] mm</p>
  <ul>{sketch.constraints.map((c:any)=><li key={c.name}>{c.name} · {c.kind}{c.value===null?'':` · ${Number(c.value.toFixed(6))} mm`}</li>)}</ul>
 </section>;
}
