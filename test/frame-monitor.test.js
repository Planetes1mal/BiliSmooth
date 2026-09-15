const test = require("node:test");
const assert = require("node:assert/strict");
const { create } = require("../src/page/frame-monitor");

function fixture({fps=60,rate=1}={}) {
  const monitor=create();monitor.reset(0);
  const sample=(now,extra={})=>monitor.sample({now,playhead:now/1000*rate,active:true,grace:false,fps,rate,...extra});
  const frame=(now,count,mediaTime=now/1000*rate)=>monitor.frame({now,presentedFrames:count,mediaTime});
  function healthy() {
    sample(0);frame(10,1);frame(30,2);frame(50,3);
    assert.equal(sample(60).state,"healthy");
  }
  return {monitor,sample,frame,healthy};
}

test("manifest FPS does not make a stopped compositor look healthy while the clock advances",()=>{
  const f=fixture();f.healthy();f.sample(1000);const state=f.sample(2100);
  assert.equal(state.state,"frozen");assert.equal(state.source,"rvfc");assert.equal(state.presentedFrames,3);
  assert.equal(state.ageMs,2050);assert.equal(state.thresholdMs,2000);
});
test("ordinary advancing frames remain healthy regardless of identical video pixels",()=>{
  const f=fixture();f.healthy();
  for(let at=100;at<=4000;at+=100) {f.frame(at,3+at/100);assert.equal(f.sample(at).state,"healthy");}
});
test("two separate advancing observations are required before healthy",()=>{
  const f=fixture();f.sample(0);f.frame(10,400);
  assert.equal(f.sample(15).state,"unknown");f.frame(30,500);
  assert.equal(f.sample(35).state,"unknown");f.frame(50,501);
  assert.equal(f.sample(55).state,"healthy");
});
test("one resumed callback or repeated counter cannot hide an established freeze",()=>{
  const f=fixture();f.healthy();f.sample(1000);assert.equal(f.sample(2100).state,"frozen");
  f.frame(2200,4);assert.equal(f.sample(2210).state,"frozen");
  f.frame(2250,4);assert.equal(f.sample(2260).state,"frozen");
  f.frame(2300,5);assert.equal(f.sample(2310).state,"healthy");
});
test("isolated callbacks separated by long gaps do not count as sustained recovery",()=>{
  const f=fixture();f.healthy();f.sample(1000);f.sample(2100);
  f.frame(2200,4);f.sample(2300);f.sample(3300);f.sample(4400);f.frame(4500,5);
  assert.equal(f.sample(4510).state,"frozen");
});
test("an advancing media clock without a frame baseline stays unknown",()=>{
  const f=fixture();f.sample(0);f.sample(1000);const state=f.sample(3000);
  assert.equal(state.state,"unknown");assert.equal(state.source,null);assert.equal(state.ageMs,null);
});
test("one initial callback is insufficient evidence to declare normal playback or a freeze",()=>{
  const f=fixture();f.sample(0);f.frame(10,1);f.sample(1000);
  assert.equal(f.sample(3000).state,"unknown");
});
test("low frame rates extend the no-frame threshold by their actual interval",()=>{
  const f=fixture({fps:1});f.sample(0);f.frame(10,1,0);f.frame(1010,2,1);f.frame(2010,3,2);
  assert.equal(f.sample(2100).state,"healthy");f.sample(3100);f.sample(4100);
  const grace=f.sample(4500);assert.equal(grace.state,"healthy");assert.equal(grace.thresholdMs,3250);
  assert.equal(f.sample(5400).state,"frozen");
});
test("low frame rate thresholds account for playback speed",()=>{
  const slow=fixture({fps:1,rate:0.5});slow.sample(0);
  assert.equal(slow.sample(10).thresholdMs,6250);
  const fast=fixture({fps:1,rate:2});fast.sample(0);
  assert.equal(fast.sample(10).thresholdMs,2000);
});
test("inferred callback cadence protects low-FPS media when manifest FPS is unknown",()=>{
  const f=fixture({fps:null});f.sample(0);f.frame(10,1,0);f.frame(1510,2,1.5);f.frame(3010,3,3);
  const state=f.sample(3100);assert.equal(state.state,"healthy");assert.equal(state.thresholdMs,4750);
});
test("missed callbacks with a frame-count jump do not imply low media FPS",()=>{
  const f=fixture();f.healthy();f.frame(1000,60,1);f.frame(2000,120,2);
  assert.equal(f.sample(2010).thresholdMs,2000);
});
test("paused, hidden or ended input clears frame history before visible resumption",()=>{
  const f=fixture();f.healthy();assert.equal(f.sample(500,{active:false}).state,"unknown");
  assert.equal(f.frame(800,30),false);assert.equal(f.sample(3000).state,"unknown");
  f.frame(3010,31);f.frame(3030,32);assert.equal(f.sample(3040).state,"unknown");
  f.frame(3050,33);assert.equal(f.sample(3060).state,"healthy");
});
test("startup and seek grace prevent building a false frozen baseline",()=>{
  const f=fixture();f.sample(0,{grace:true});assert.equal(f.frame(100,1),false);
  assert.equal(f.sample(2500,{grace:true}).reason,"grace");
  assert.equal(f.sample(2600).state,"unknown");f.frame(2610,10);f.frame(2630,11);f.frame(2650,12);
  assert.equal(f.sample(2660).state,"healthy");
});
test("a forward or backward playhead jump resets presentation evidence",()=>{
  for(const playhead of [30,-1]) {
    const f=fixture();f.healthy();assert.equal(f.sample(1000,{playhead}).state,"unknown");
    assert.equal(f.sample(1100,{playhead:playhead+0.1}).source,null);
  }
});
test("large sampling gaps and non-monotonic time revalidate instead of declaring freeze",()=>{
  const f=fixture();f.healthy();assert.equal(f.sample(10000).state,"unknown");assert.equal(f.sample(10000).source,null);
  const reverse=fixture();reverse.healthy();assert.equal(reverse.sample(20).state,"unknown");
});
test("counter rollback clears evidence and needs two new frame advances",()=>{
  const f=fixture();f.healthy();f.frame(100,0,0.1);assert.equal(f.sample(110).state,"unknown");
  f.frame(120,1);assert.equal(f.sample(130).state,"unknown");f.frame(140,2);
  assert.equal(f.sample(150).state,"healthy");
});
test("frozen frame detection requires clock progression, not a stopped playback clock",()=>{
  const f=fixture();f.healthy();f.sample(1000,{playhead:0.06});
  const state=f.sample(2400,{playhead:0.06});assert.equal(state.state,"unknown");assert.equal(state.reason,"clock-not-advancing");
});
test("quality fallback subtracts dropped frames and detects presentation counter stagnation",()=>{
  const f=fixture();
  f.sample(0,{quality:{totalVideoFrames:100,droppedVideoFrames:0}});
  f.sample(1000,{quality:{totalVideoFrames:160,droppedVideoFrames:0}});
  assert.equal(f.sample(2000,{quality:{totalVideoFrames:220,droppedVideoFrames:0}}).state,"healthy");
  f.sample(3000,{quality:{totalVideoFrames:280,droppedVideoFrames:60}});
  const state=f.sample(4100,{quality:{totalVideoFrames:340,droppedVideoFrames:120}});
  assert.equal(state.state,"frozen");assert.equal(state.presentedFrames,220);assert.equal(state.source,"quality");
});
test("quality polling also requires two new advances to recover",()=>{
  const f=fixture();
  f.sample(0,{quality:{totalVideoFrames:10,droppedVideoFrames:0}});
  f.sample(1000,{quality:{totalVideoFrames:20,droppedVideoFrames:0}});
  f.sample(2000,{quality:{totalVideoFrames:30,droppedVideoFrames:0}});
  f.sample(3000,{quality:{totalVideoFrames:30,droppedVideoFrames:0}});
  assert.equal(f.sample(4100,{quality:{totalVideoFrames:30,droppedVideoFrames:0}}).state,"frozen");
  assert.equal(f.sample(5000,{quality:{totalVideoFrames:40,droppedVideoFrames:0}}).state,"frozen");
  assert.equal(f.sample(6000,{quality:{totalVideoFrames:50,droppedVideoFrames:0}}).state,"healthy");
});
test("quality counters cannot mask a frozen established rVFC source",()=>{
  const f=fixture();f.healthy();f.sample(1000,{quality:{totalVideoFrames:1000,droppedVideoFrames:0}});
  const state=f.sample(2100,{quality:{totalVideoFrames:2000,droppedVideoFrames:0}});
  assert.equal(state.state,"frozen");assert.equal(state.source,"rvfc");assert.equal(state.presentedFrames,3);
});
test("rVFC replaces quality fallback with a fresh presentation baseline",()=>{
  const f=fixture();f.sample(0,{quality:{totalVideoFrames:10,droppedVideoFrames:0}});
  f.sample(1000,{quality:{totalVideoFrames:20,droppedVideoFrames:0}});
  assert.equal(f.sample(2000,{quality:{totalVideoFrames:30,droppedVideoFrames:0}}).state,"healthy");
  f.frame(2010,500);assert.equal(f.sample(2020).state,"unknown");
  f.frame(2030,501);f.frame(2050,502);assert.equal(f.sample(2060).state,"healthy");
});
test("malformed quality counters and nonfinite values never fabricate presented frames",()=>{
  const f=fixture();
  for(const quality of [{totalVideoFrames:10,droppedVideoFrames:11},{totalVideoFrames:NaN,droppedVideoFrames:0},{totalVideoFrames:10}]) {
    assert.equal(f.sample(0,{quality}).presentedFrames,null);
  }
  assert.equal(f.frame(10,Infinity),false);assert.equal(f.frame(20,-1),false);
  assert.equal(f.sample(NaN).state,"unknown");
});
test("sparse recovery frames cannot inflate a known 60 fps freeze threshold",()=>{
  const f=fixture();f.healthy();f.sample(1000);f.sample(2100);
  for(const [now,count] of [[2200,4],[4400,5],[6600,6]]) {
    f.frame(now,count);const state=f.sample(now+10);
    assert.equal(state.state,"frozen");assert.equal(state.thresholdMs,2000);
  }
});
test("a freeze cannot teach the fallback cadence estimator a slower video rate",()=>{
  const f=fixture({fps:null});f.healthy();f.sample(1000);f.sample(2100);
  f.frame(3000,4);const state=f.sample(3010);
  assert.equal(state.state,"frozen");assert.equal(state.thresholdMs,2000);
});
test("a previously frozen stream becomes unknown when its media clock also stops",()=>{
  const f=fixture();f.healthy();f.sample(1000);assert.equal(f.sample(2100).state,"frozen");
  f.sample(3100,{playhead:2.1});const stopped=f.sample(4200,{playhead:2.1});
  assert.equal(stopped.state,"unknown");assert.equal(stopped.reason,"clock-not-advancing");
  assert.equal(f.sample(4400,{playhead:2.3}).state,"frozen");
  f.frame(4500,4,2.4);assert.equal(f.sample(4510,{playhead:2.41}).state,"frozen");
  f.frame(4600,5,2.5);assert.equal(f.sample(4610,{playhead:2.51}).state,"healthy");
});
