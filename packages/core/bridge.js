import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, statSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BridgeError, catalog, normalizeError, validateBatch, validateFrame, validateVideo, PROTOCOL_VERSION } from '../protocol/index.js';
import { sampleFrames } from '../previews/sampling.js';
import { assembleSheet, resizePng, cropPng, encodeVideo } from '../previews/sheet.js';
import { Storage } from './storage.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// AE 26's saveFrameToPng returns before the file is written; wait for a complete PNG (ends with its IEND chunk).
export async function waitForPng(path, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (existsSync(path) && statSync(path).size >= 16 && readFileSync(path).subarray(-8, -4).toString('latin1') === 'IEND') return true;
    await sleep(100);
  } while (Date.now() < deadline);
  return false;
}

export class Bridge {
  constructor(paths, secret) {
    this.paths = paths; this.secret = secret; this.storage = new Storage(paths.root);
    mkdirSync(paths.artifacts, { recursive:true, mode:0o700 });
    this.panel = null; this.pending = new Map(); this.lane = Promise.resolve(); this.currentJobId = null;
    this.instanceId = randomUUID();
  }
  authenticated(candidate) {
    if (typeof candidate !== 'string') return false;
    const a = Buffer.from(candidate), b = Buffer.from(this.secret);
    return a.length === b.length && timingSafeEqual(a,b);
  }
  attachPanel(peer) {
    let ready = false;
    peer.on('message', msg => {
      if (!ready) {
        if (msg?.type !== 'hello' || !this.authenticated(msg.secret) || msg.protocolVersion !== PROTOCOL_VERSION || !msg.sessionNonce) { peer.close(1008); return; }
        if (this.panel) this.panel.peer.close(1001);
        const sessionId = `session_${randomUUID()}`;
        this.panel = { peer, sessionId, scope:msg.scope === 'edit' ? 'edit' : 'read', hello: { adapterVersion:msg.adapterVersion, aeVersion:msg.aeVersion, os:msg.os, sessionNonce:msg.sessionNonce }, responsive:true };
        ready = true;
        peer.send({ type:'welcome', protocolVersion:PROTOCOL_VERSION, projectSessionId:sessionId });
        return;
      }
      if (msg?.type === 'result' && typeof msg.id === 'string') {
        const p = this.pending.get(msg.id);
        if (p) { clearTimeout(p.timer); this.pending.delete(msg.id); msg.ok ? p.resolve(msg.value) : p.reject(new BridgeError(msg.error?.code || 'AE_ERROR', msg.error?.message || 'AE operation failed', msg.error?.details || {})); }
      }
    });
    peer.on('close', () => {
      if (ready && this.panel?.peer === peer) this.panel = null;
      for (const [id, p] of this.pending) if (p.peer === peer) { clearTimeout(p.timer); p.reject(new BridgeError(p.mutation ? 'OUTCOME_UNKNOWN' : 'AE_DISCONNECTED', 'AE panel disconnected during command; inspect before retrying')); this.pending.delete(id); }
    });
    peer.on('error', () => {});
  }
  requirePanel(sessionId) {
    if (!this.panel) throw new BridgeError('AE_DISCONNECTED', 'Open the After Effects Bridge panel and connect it');
    if (!this.panel.responsive) throw new BridgeError('AE_UNRESPONSIVE', 'Panel did not answer; reconnect and inspect AE');
    if (sessionId && sessionId !== this.panel.sessionId) throw new BridgeError('WRONG_PROJECT', 'Project session changed; inspect and refresh references');
    return this.panel;
  }
  enqueue(fn) {
    const run = this.lane.then(fn, fn);
    this.lane = run.catch(() => {});
    return run;
  }
  command(method, params = {}, { timeout = 20000, mutation = false } = {}) {
    const panel = this.requirePanel(params.projectSessionId);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); panel.responsive = false;
        reject(new BridgeError(mutation ? 'OUTCOME_UNKNOWN' : 'AE_UNRESPONSIVE', `AE did not answer ${method} within ${timeout}ms; reconnect and inspect before retrying`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, mutation, peer:panel.peer });
      panel.peer.send({ type:'command', id, method, params });
    });
  }
  async inspectRaw(fields = 'summary') {
    const panel = this.requirePanel();
    const value = await this.command('inspect', { fields, projectSessionId:panel.sessionId });
    return { ...value, projectSessionId:panel.sessionId, capabilities: value.capabilities || {} };
  }
  token(inspection) { return 'inspection_' + createHash('sha256').update(JSON.stringify(inspection)).digest('hex').slice(0,32); }
  async inspection(fields = 'summary') {
    const value = await this.inspectRaw(fields);
    return { ...value, inspectionToken:this.token(value) };
  }
  async context() {
    if (!this.panel) return { connected:false, protocolVersion:PROTOCOL_VERSION };
    const x = await this.inspection();
    return { connected:true, scope:this.panel.scope, projectSessionId:x.projectSessionId, project:x.project, activeComp:x.activeComp, selection:x.selection, currentTime:x.currentTime, capabilities:x.capabilities, inspectionToken:x.inspectionToken, adapter:this.panel.hello };
  }
  async apply(batch, preflightOnly = false) {
    validateBatch(batch);
    if (preflightOnly) return { state:'validated', preflightOnly:true, warning:'Host state and references have not been checked' };
    const existing = this.storage.job(batch.requestId);
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(batch)) throw new BridgeError('REQUEST_ID_CONFLICT','Request ID was already used for a different batch');
      return existing;
    }
    if (this.requirePanel(batch.projectSessionId).scope !== 'edit') throw new BridgeError('READ_ONLY','Enable edits in the AE panel and reconnect');
    const job = this.storage.createJob(batch.requestId, 'apply', batch);
    this.storage.updateJob(job.id, 'validated');
    this.storage.updateJob(job.id, 'queued');
    return this.enqueue(async () => {
      try {
        this.currentJobId = job.id;
        const before = await this.inspectRaw();
        if (before.truncated) throw new BridgeError('UNSUPPORTED_CAPABILITY', 'Inspection was truncated; this project exceeds the current safe edit limits');
        if (this.token(before) !== batch.expectedInspectionToken) throw new BridgeError('STATE_CONFLICT', 'Inspected state changed; inspect again before applying');
        this.storage.updateJob(job.id, 'executing');
        const result = await this.command('executeBatch', batch, { mutation:true, timeout:30000 });
        try {
          const after = await this.inspectRaw();
          return this.storage.updateJob(job.id, result.state === 'partial' ? 'partial' : 'succeeded', { ...result, inspectionToken:this.token(after) });
        } catch (e) {
          return this.storage.updateJob(job.id, 'partial', { ...result, warning:'AE acknowledged the edit, but post-edit inspection failed', inspectionError:normalizeError(e) });
        }
      } catch (e) {
        return this.storage.updateJob(job.id, e.code === 'OUTCOME_UNKNOWN' ? 'outcome_unknown' : 'failed', normalizeError(e));
      } finally { this.currentJobId = null; }
    });
  }
  // Open the target comp in the viewer before baselining. A caller token taken while another item was active still
  // matches, since the only change is this viewer switch.
  async focusComp({ projectSessionId, compRef, expectedInspectionToken }) {
    this.requirePanel(projectSessionId);
    let before = await this.inspectRaw();
    if (expectedInspectionToken && expectedInspectionToken !== this.token(before)) throw new BridgeError('STATE_CONFLICT', 'Inspected state changed before rendering');
    if (before.activeComp?.ref !== compRef) {
      await this.command('openComp', { projectSessionId, compRef });
      before = await this.inspectRaw();
      if (before.activeComp?.ref !== compRef) throw new BridgeError('WRONG_PROJECT', 'Could not open the target composition in the viewer');
    }
    return before;
  }
  async renderFrame(input) {
    const params = validateFrame(input);
    return this.enqueue(() => this.renderFrameInLane(params));
  }
  async renderFrameInLane(params) {
    const before = await this.focusComp(params);
    const token = this.token(before);
    const id = `artifact_${randomUUID()}`;
    const originalPath = join(this.paths.artifacts, `${id}-original.png`);
    const host = await this.command('renderFrame', { ...params, outputPath:originalPath }, { timeout:60000 });
    if (!host?.supported) throw new BridgeError('UNSUPPORTED_CAPABILITY', host?.reason || 'Native live-frame render is unavailable on this AE build');
    if (!await waitForPng(originalPath)) throw new BridgeError('RENDER_FAILED', 'AE reported success but produced no complete PNG within 15s');
    let path=originalPath, viewingLongEdge=Math.max(host.width,host.height);
    if (viewingLongEdge > params.maxLongEdge) {
      path=join(this.paths.artifacts, `${id}.png`);
      await resizePng(originalPath,path,params.maxLongEdge);
      viewingLongEdge=params.maxLongEdge;
    }
    if (statSync(path).size > 4*1024*1024) {
      for (const size of [960,720,512]) {
        const smaller=join(this.paths.artifacts, `${id}-${size}.png`);
        await resizePng(originalPath,smaller,size);
        path=smaller; viewingLongEdge=size;
        if (statSync(path).size <= 4*1024*1024) break;
      }
      if (statSync(path).size > 4*1024*1024) throw new BridgeError('RENDER_FAILED','Viewing PNG exceeds 4 MiB response budget');
    }
    const after = await this.inspectRaw();
    const consistent = token === this.token(after);
    const metadata = { projectSessionId:params.projectSessionId, compRef:params.compRef, requestedFrame:params.frame, effectiveFrame:host.effectiveFrame, effectiveSeconds:host.effectiveSeconds, width:host.width, height:host.height, viewingLongEdge, originalPath, sourceInspectionToken:token, consistent, completeness:'complete', warnings:host.warnings || [] };
    const artifact = this.storage.addArtifact(id, 'frame', path, metadata);
    return { artifactId:id, ...metadata, path:artifact.path };
  }
  async renderContactSheet(input) {
    validateFrame({ projectSessionId:input.projectSessionId, compRef:input.compRef, frame:input.startFrame, maxLongEdge:input.maxLongEdge || 1280 });
    const frames = sampleFrames(input);
    this.requirePanel(input.projectSessionId);
    return this.enqueue(async () => {
      const before = await this.focusComp(input); const token = this.token(before);
      const entries = [], errors = [];
      for (const frame of frames) {
        try {
          const result = await this.renderFrameInLane({ projectSessionId:input.projectSessionId, compRef:input.compRef, frame, maxLongEdge:input.maxLongEdge || 1280, expectedInspectionToken:token });
          if (!result.consistent) throw new BridgeError('STATE_CONFLICT', 'Source changed during contact sheet');
          entries.push({ frame, path:result.path, artifactId:result.artifactId });
        } catch (e) { errors.push({ frame, error:normalizeError(e) }); if (e.code === 'STATE_CONFLICT' || e.code === 'AE_DISCONNECTED') break; }
      }
      if (!entries.length) throw new BridgeError('RENDER_FAILED', 'No frames rendered', { errors });
      const id = `artifact_${randomUUID()}`; const path = join(this.paths.artifacts, `${id}.png`);
      const comp = before.activeComp;
      const layout = await assembleSheet(entries, path, comp.width, comp.height, comp.frameDuration);
      const after = await this.inspectRaw();
      const consistent = token === this.token(after) && errors.every(x => x.error.code !== 'STATE_CONFLICT');
      const metadata = { projectSessionId:input.projectSessionId, compRef:input.compRef, requestedFrames:frames, tiles:entries.map((x,i) => ({ tile:i+1, frame:x.frame, artifactId:x.artifactId })), omitted:errors, layout, sourceInspectionToken:token, consistent, completeness: errors.length ? 'partial' : 'complete' };
      this.storage.addArtifact(id, 'contact_sheet', path, metadata);
      return { artifactId:id, ...metadata, path };
    });
  }
  // Frames can take minutes, longer than an RPC call may wait, so this returns a job to poll with ae_job.
  renderVideo(input) {
    const params = validateVideo(input);
    this.requirePanel(params.projectSessionId);
    const id = `render_${randomUUID()}`;
    this.storage.createJob(id, 'render_video', params);
    this.storage.updateJob(id, 'queued');
    this.enqueue(() => this.renderVideoInLane(id, params));
    return { jobId:id, state:'queued', frames:params.endFrameExclusive - params.startFrame, next:'Poll ae_job with jobId until state is succeeded or failed' };
  }
  async renderVideoInLane(jobId, params) {
    const dir = join(this.paths.artifacts, `${jobId}-frames`);
    try {
      this.currentJobId = jobId;
      const before = await this.focusComp(params), token = this.token(before), comp = before.activeComp;
      if (params.endFrameExclusive * comp.frameDuration > comp.duration + comp.frameDuration / 2) throw new BridgeError('INVALID_ARGUMENT', 'endFrameExclusive is past the end of the composition');
      const total = params.endFrameExclusive - params.startFrame;
      mkdirSync(dir, { recursive:true, mode:0o700 });
      this.storage.updateJob(jobId, 'executing', { progress:{ done:0, total } });
      for (let i = 0; i < total; i++) {
        const frame = params.startFrame + i, outputPath = join(dir, `f${String(i).padStart(5, '0')}.png`);
        const host = await this.command('renderFrame', { projectSessionId:params.projectSessionId, compRef:params.compRef, frame, outputPath }, { timeout:60000 });
        if (!host?.supported) throw new BridgeError('UNSUPPORTED_CAPABILITY', host?.reason || 'Native live-frame render is unavailable on this AE build');
        if (!await waitForPng(outputPath)) throw new BridgeError('RENDER_FAILED', `AE produced no complete PNG for frame ${frame} within 15s`);
        if ((i + 1) % 10 === 0) this.storage.updateJob(jobId, 'executing', { progress:{ done:i + 1, total } });
      }
      const fps = Math.round(1000 / comp.frameDuration) / 1000;
      const path = params.outputPath || join(this.paths.artifacts, `${jobId}.mp4`);
      mkdirSync(dirname(path), { recursive:true });
      await encodeVideo(dir, path, fps, params.maxLongEdge);
      const consistent = token === this.token(await this.inspectRaw());
      const artifactId = `artifact_${randomUUID()}`;
      const metadata = { projectSessionId:params.projectSessionId, compRef:params.compRef, startFrame:params.startFrame, endFrameExclusive:params.endFrameExclusive, frames:total, fps, seconds:total / fps, sourceInspectionToken:token, consistent };
      this.storage.addArtifact(artifactId, 'video', path, metadata);
      return this.storage.updateJob(jobId, 'succeeded', { artifactId, path, ...metadata });
    } catch (e) {
      return this.storage.updateJob(jobId, 'failed', normalizeError(e));
    } finally { this.currentJobId = null; rmSync(dir, { recursive:true, force:true }); }
  }
  async artifact(params) {
    const source=this.storage.artifact(params.id);
    if (!source) throw new BridgeError('NOT_FOUND','Artifact not found');
    if (!params.crop) return source;
    if (source.kind !== 'frame' || !source.metadata.originalPath || source.metadata.crop) throw new BridgeError('UNSUPPORTED_CAPABILITY','Crops require an uncropped original frame artifact');
    const c=params.crop, width=source.metadata.width, height=source.metadata.height;
    if (![c.x,c.y,c.width,c.height].every(Number.isSafeInteger) || c.x<0 || c.y<0 || c.width<1 || c.height<1 || c.x+c.width>width || c.y+c.height>height)
      throw new BridgeError('INVALID_ARGUMENT','Crop must be an integer rectangle inside the original frame');
    const maxLongEdge=params.maxLongEdge ?? 1280;
    if (!Number.isInteger(maxLongEdge) || maxLongEdge<64 || maxLongEdge>4096) throw new BridgeError('INVALID_ARGUMENT','maxLongEdge must be 64..4096');
    const id=`artifact_${randomUUID()}`, path=join(this.paths.artifacts,`${id}.png`);
    await cropPng(source.metadata.originalPath,path,c,maxLongEdge);
    if (statSync(path).size>4*1024*1024) throw new BridgeError('RENDER_FAILED','Crop exceeds 4 MiB response budget; request a smaller crop');
    return this.storage.addArtifact(id,'frame',path,{...source.metadata,sourceArtifactId:source.id,crop:c,originalPath:source.metadata.originalPath,width:c.width,height:c.height,viewingLongEdge:maxLongEdge});
  }
  async rpc(method, params = {}) {
    switch (method) {
      case 'ae_context': return this.context();
      case 'ae_inspect': return this.enqueue(() => this.inspection(params.fields));
      case 'ae_catalog': return { protocolVersion:PROTOCOL_VERSION, operations:catalog, capabilities:this.panel ? (await this.context()).capabilities : {} };
      case 'ae_apply': return this.apply(params.batch, params.preflightOnly);
      case 'ae_render_frame': return this.renderFrame(params);
      case 'ae_render_contact_sheet': return this.renderContactSheet(params);
      case 'ae_render_video': return this.renderVideo(params);
      case 'ae_job': return this.storage.job(params.id) || (() => { throw new BridgeError('NOT_FOUND','Job not found'); })();
      case 'ae_artifact': return this.artifact(params);
      case 'ae_recent_artifacts': return this.storage.recentArtifacts();
      default: throw new BridgeError('UNSUPPORTED_CAPABILITY', `Unknown method ${method}`);
    }
  }
}
