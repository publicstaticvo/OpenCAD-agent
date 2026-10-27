/** Reconstruct configuration in a fresh process without contacting the model service. */
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ModelConfig} from '../gateway/model-config.ts';
const directory=process.argv[2];
if(!directory)throw new Error('Data directory required');
const config=new ModelConfig(directory);
const status=config.status();
assert.equal(status.configured,true);
const approval=JSON.parse(readFileSync(join(directory,'approved.json'),'utf8'));
assert.deepEqual(approval.provider,'provider' in status?status.provider:undefined);
assert.equal(approval.approved,true);
const privateSettings=JSON.parse(readFileSync(join(directory,'model-settings.json'),'utf8'));
assert.ok(!JSON.stringify(status).includes(privateSettings.apiKey));
assert.ok(!JSON.stringify(approval).includes(privateSettings.apiKey));
console.log('Saved model configuration reopened; public approval and credential isolation verified');
