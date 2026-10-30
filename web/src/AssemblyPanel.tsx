export function AssemblyPanel({assembly,revision,candidate=false,onSelect}:{assembly:any;revision:number;candidate?:boolean;onSelect?:(id:string)=>void}){
 if(!assembly)return null;
 return <section className="assembly-panel" data-testid="assembly-panel">
  <h2>{candidate?'候选装配':'正式装配'} · 修订 {revision}</h2>
  <p>底板接地 · 圆柱销固定关节 · mm</p>
  <nav aria-label="装配组件">{assembly.components.map((component:any)=><button key={component.id} onClick={()=>onSelect?.(component.partId)}>{component.id} · [{component.position.join(', ')}]</button>)}</nav>
  <h3>BOM</h3><table><thead><tr><th>编号 / 名称</th><th>数量</th></tr></thead><tbody>{assembly.bom.map((part:any)=><tr key={part.partId}><td>{part.number} / {part.name}<details><summary>实际参数</summary><pre>{JSON.stringify(part.parameters,null,2)}</pre></details></td><td>{part.quantity}</td></tr>)}</tbody></table>
  <h3>装配几何检查</h3><p role="status">{assembly.interference.status==='clear'?'装配有效 · 销与孔同轴且已贯穿，无实体材料重叠':assembly.interference.status==='collision'?'存在真实干涉':assembly.interference.status==='invalid'?'装配无效 · '+assembly.interference.reason:'检查失败，无法判定'}</p>
  {assembly.interference.pairs.map((pair:any)=><p key={pair.components.join('/')}>{pair.components.join(' ↔ ')}：{Number(pair.volume.toFixed(6))} mm³</p>)}
 </section>;
}
