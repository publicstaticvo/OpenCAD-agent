import {RevisionStore} from '../../gateway/revision-store.ts';import {Supervisor} from '../../gateway/supervisor.ts';
const store=new RevisionStore(process.argv[2]);const s=await Supervisor.start(store,{observe(phase){if(phase==='opened')process.kill(process.pid,'SIGKILL');}});
s.submit('plate',1,'crash',JSON.parse(process.argv[3]));await s.waitForJob('plate','crash');
