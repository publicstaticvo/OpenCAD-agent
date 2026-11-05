import {forwardRef,useEffect,useImperativeHandle,useRef} from 'react';
import {EditorState,Prec,Transaction} from '@codemirror/state';
import {EditorView,keymap} from '@codemirror/view';
import {undo,redo,selectAll} from '@codemirror/commands';
import {openSearchPanel} from '@codemirror/search';
import {python} from '@codemirror/lang-python';
import {getDefaultExtensions} from '@uiw/react-codemirror';

export type EditorCommand='undo'|'redo'|'find'|'replace'|'selectAll'|'copy'|'cut'|'paste';
export type ProjectEditorHandle={command:(name:EditorCommand)=>Promise<void>;remap:(source:string,destination:string)=>void;};
export const ProjectEditor=forwardRef<ProjectEditorHandle,{path:string;value:string;readonly:boolean;identity:string;openFiles:string[];onChange:(path:string,value:string)=>void;onSave:()=>void;onError:(message:string)=>void}>(function ProjectEditor(props,ref){
 const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),states=useRef(new Map<string,EditorState>()),current=useRef(''),sync=useRef(false),latest=useRef(props);latest.current=props;
 const stateKey=`${props.identity}:${props.path}`;
 useImperativeHandle(ref,()=>({
  async command(name){const editor=view.current;if(!editor||!latest.current.path)return;editor.focus();
   if(name==='undo'){undo(editor);return;}if(name==='redo'){redo(editor);return;}if(name==='selectAll'){selectAll(editor);return;}
   if(name==='find'||name==='replace'){openSearchPanel(editor);if(name==='replace')editor.dom.querySelector<HTMLInputElement>('input[name="replace"]')?.focus();return;}
   const state=editor.state,identity=current.current,range=state.selection.main;
   const unchanged=()=>{if(editor.state!==state||current.current!==identity)throw new Error('剪贴板处理期间文件或选区已改变，请在当前文件重新执行该命令。');};
   if(name==='paste'){if(latest.current.readonly)return;const text=await navigator.clipboard.readText();unchanged();editor.dispatch(editor.state.replaceSelection(text));return;}
   await navigator.clipboard.writeText(state.sliceDoc(range.from,range.to));if(name==='cut'&&!latest.current.readonly){unchanged();editor.dispatch({changes:{from:range.from,to:range.to,insert:''}});}
  },
  remap(source,destination){const next=new Map<string,EditorState>();for(const [key,state]of states.current){const separator=key.indexOf(':');const path=key.slice(separator+1);next.set(key.slice(0,separator+1)+(path===source||path.startsWith(source+'/')?destination+path.slice(source.length):path),state);}states.current=next;current.current='';},
 }));
 useEffect(()=>{
  const editor=new EditorView({parent:host.current!,state:EditorState.create({doc:''})});view.current=editor;
  return()=>{editor.destroy();view.current=null;states.current.clear();};
 },[]);
 useEffect(()=>{
  const editor=view.current;if(!editor)return;
  if(current.current&&current.current!==stateKey)states.current.set(current.current,editor.state);
  let state=states.current.get(stateKey);
  if(!state){state=EditorState.create({doc:props.value,extensions:[...getDefaultExtensions({theme:'light',editable:!props.readonly,readOnly:props.readonly,basicSetup:{lineNumbers:true,foldGutter:true,highlightActiveLine:true,autocompletion:false}}),python(),Prec.highest(keymap.of([{key:'Mod-s',run:()=>{latest.current.onSave();return true;}}])),EditorView.updateListener.of(update=>{states.current.set(current.current,update.state);if(update.docChanged&&!sync.current&&!latest.current.readonly)latest.current.onChange(latest.current.path,update.state.doc.toString());})]});states.current.set(stateKey,state);}
  if(current.current!==stateKey){current.current=stateKey;editor.setState(state);}
  if(editor.state.doc.toString()!==props.value){sync.current=true;editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:props.value},annotations:Transaction.addToHistory.of(false)});sync.current=false;}
 },[stateKey,props.value,props.readonly]);
 useEffect(()=>{for(const key of states.current.keys()){if(key.startsWith('working:')&&!props.openFiles.includes(key.slice(8)))states.current.delete(key);}},[props.openFiles]);
 return <div ref={host} className="project-editor cm-theme-light" data-testid="project-editor"/>;
});
