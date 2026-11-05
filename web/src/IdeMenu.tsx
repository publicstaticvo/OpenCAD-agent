import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
export type MenuItem={label:string;shortcut?:string;disabled?:boolean;reason?:string;action:()=>void}|null;
export function IdeMenu({items,x,y,onClose,label}:{items:MenuItem[];x:number;y:number;onClose:()=>void;label:string}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const menu=ref.current!;
  const rect=menu.getBoundingClientRect();menu.style.left=`${Math.max(4,Math.min(x,innerWidth-rect.width-6))}px`;menu.style.top=`${Math.max(4,Math.min(y,innerHeight-rect.height-6))}px`;
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  const outside=(event:Event)=>{if(!menu.contains(event.target as Node))onClose();};document.addEventListener('pointerdown',outside);window.addEventListener('blur',onClose);
  return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('blur',onClose);};
 },[]);
 return createPortal(<div ref={ref} role="menu" aria-label={label} className="ide-menu" style={{left:x,top:y}} onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();onClose();return;}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
 }}>{items.map((item,index)=>item?<button role="menuitem" aria-label={item.label} key={item.label} title={item.reason} disabled={item.disabled} onClick={()=>{onClose();item.action();}}><span>{item.label}</span>{item.shortcut&&<kbd>{item.shortcut}</kbd>}</button>:<hr key={index}/>)}</div>,document.body);
}
