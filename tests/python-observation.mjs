import {convertMessages} from '../pi/packages/ai/src/api/openai-completions.ts';
import {convertResponsesMessages} from '../pi/packages/ai/src/api/openai-responses-shared.ts';

/** Exercise Pi request serialization with actual execution observations, without HTTP. */
export function observationRequests(content){
 const model={api:'openai-completions',provider:'cad-configured',id:'local',input:['text','image']};
 const context={messages:[{role:'toolResult',toolCallId:'native-python',toolName:'cad_python',content,isError:false,timestamp:Date.now()}]};
 return{
  completions:convertMessages(model,context,{supportsDeveloperRole:false}),
  responses:convertResponsesMessages({...model,api:'openai-responses'},context,new Set(['cad-configured'])),
 };
}
