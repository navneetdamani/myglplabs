import test from'node:test';import assert from'node:assert/strict';import{plan}from'../agent.mjs';
test('server cannot fall back to paid API inference',async()=>{await assert.rejects(plan({openaiKey:'unused'},'request',{},()=>{throw Error('Network must not be called');}),/Paid API planning is disabled/);});
