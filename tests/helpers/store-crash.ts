import {RevisionStore} from '../../gateway/revision-store.ts';
const [root,envelope,request,point]=process.argv.slice(2);
const store=new RevisionStore(root,{boundary(name){if(name===point)process.kill(process.pid,'SIGKILL');}});
store.commitCandidate(JSON.parse(envelope),JSON.parse(request));
store.close();
