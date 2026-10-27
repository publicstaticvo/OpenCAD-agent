import OpenAI, {type ClientOptions} from 'openai';

/** OpenAI's default implementation schedules an immediate abort for timeout=0. */
class ConfigurableTimeoutOpenAI extends OpenAI {
 override async fetchWithTimeout(url:RequestInfo,init:RequestInit|undefined,ms:number,controller:AbortController):Promise<Response>{
  if(ms!==0)return super.fetchWithTimeout(url,init,ms,controller);
  const signal=init?.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal;
  return this.fetch(url,{...init,signal});
 }
}
export function createOpenAIClient(options:ClientOptions):OpenAI{return new ConfigurableTimeoutOpenAI(options);}
