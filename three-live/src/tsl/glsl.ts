/**
 * @license
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Loop-Free TSL (`GOOGLE_material_tsl`) -> GLSL ES 300 Compiler.
 */

import {
  MAX_TSL_UNIFORMS,
  TSL_TIME_PERIOD_SEC,
  tslTypeArity,
  type TslType,
  type ValidatedTslGraph,
  type ValidatedTslNode,
} from './ir';

/** Formats a finite IEEE-754 fp32 constant for GLSL ES 300 / WGSL / Filament. */
export function fmtShaderFloat(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0.0';
  const f = Math.fround(n);
  const abs = Math.abs(f);
  if (abs >= 1e-4 && abs < 1e6) {
    const fixed = Number(f.toPrecision(7)).toString();
    return fixed.includes('.') ? fixed : `${fixed}.0`;
  }
  const parts = f.toExponential(6).split('e');
  const cleanMant = parts[0]
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '.0');
  return `${cleanMant}e${parts[1]}`;
}

/** Shared helper-usage bitflags across GLSL and WGSL emitters. */
export interface TslHelperFlags {
  div: boolean;
  mod: boolean;
  pow: boolean;
  clamp: boolean;
  smooth: boolean;
  atan2: boolean;
  norm: boolean;
  fresnel: boolean;
  snoise2: boolean;
  snoise3: boolean;
  voronoi2: boolean;
  checker: boolean;
  triplanar: boolean;
  hueShift: boolean;
  bump: boolean;
}

/** Scans reachable SSA nodes to emit only required helper functions. */
export function scanTslHelpers(
  nodes: readonly ValidatedTslNode[],
  reachable: Uint8Array,
  usesTime: boolean,
): TslHelperFlags {
  const f: TslHelperFlags = {
    div: false,
    mod: usesTime,
    pow: false,
    clamp: false,
    smooth: false,
    atan2: false,
    norm: false,
    fresnel: false,
    snoise2: false,
    snoise3: false,
    voronoi2: false,
    checker: false,
    triplanar: false,
    hueShift: false,
    bump: false,
  };
  for (let i = 0; i < nodes.length; i++) {
    if (!reachable[i]) continue;
    switch (nodes[i].op) {
      case 'div':
        f.div = true;
        break;
      case 'mod':
        f.mod = true;
        break;
      case 'pow':
        f.pow = true;
        break;
      case 'clamp':
        f.clamp = true;
        break;
      case 'smoothstep':
        f.smooth = true;
        f.div = true;
        f.clamp = true;
        break;
      case 'atan2':
        f.atan2 = true;
        break;
      case 'normalize':
        f.norm = true;
        break;
      case 'fresnel':
        f.fresnel = true;
        f.pow = true;
        f.norm = true;
        break;
      case 'simplexNoise2D':
        f.snoise2 = true;
        break;
      case 'simplexNoise3D':
        f.snoise3 = true;
        break;
      case 'voronoi2D':
        f.voronoi2 = true;
        break;
      case 'checker':
        f.checker = true;
        f.mod = true;
        break;
      case 'triplanar':
        f.triplanar = true;
        f.snoise2 = true;
        f.pow = true;
        f.norm = true;
        break;
      case 'hueShift':
        f.hueShift = true;
        break;
      case 'bumpFromHeight':
        f.bump = true;
        f.norm = true;
        break;
      default:
        break;
    }
  }
  return f;
}

const COMPS = ['x', 'y', 'z', 'w'] as const;
const VEC_TYS: ReadonlyArray<[number, string]> = [
  [2, 'vec2'],
  [3, 'vec3'],
  [4, 'vec4'],
];

function vecOverloads(fnName: string, arityArgs: 2 | 3): string[] {
  return VEC_TYS.map(([n, ty]) => {
    const calls = COMPS.slice(0, n)
      .map((c) =>
        arityArgs === 2
          ? `${fnName}(a.${c},b.${c})`
          : `${fnName}(a.${c},b.${c},c.${c})`,
      )
      .join(',');
    return arityArgs === 2
      ? `${ty} ${fnName}(${ty} a,${ty} b){return ${ty}(${calls});}`
      : `${ty} ${fnName}(${ty} a,${ty} b,${ty} c){return ${ty}(${calls});}`;
  });
}

function emitGlslHelpers(f: TslHelperFlags, isFragment: boolean): string {
  const out: string[] = [];
  if (f.div) {
    out.push(
      'float _tslDiv(float a,float b){return a/(abs(b)<1e-6?(b<0.0?-1e-6:1e-6):b);}',
      ...vecOverloads('_tslDiv', 2),
    );
  }
  if (f.mod) {
    out.push(
      'float _tslMod(float a,float b){float d=abs(b)<1e-6?(b<0.0?-1e-6:1e-6):b;return a-d*floor(a/d);}',
      ...vecOverloads('_tslMod', 2),
    );
  }
  if (f.pow) {
    out.push(
      'float _tslPow(float a,float b){float e=clamp(b,-64.0,64.0);return abs(e)<1e-8?1.0:(a<=0.0?0.0:pow(max(a,1e-8),e));}',
      ...vecOverloads('_tslPow', 2),
    );
  }
  if (f.clamp) {
    out.push(
      'float _tslClamp(float a,float b,float c){return clamp(a,min(b,c),max(b,c));}',
      ...vecOverloads('_tslClamp', 3),
    );
  }
  if (f.smooth) {
    out.push(
      'float _tslSmooth(float a,float b,float c){float t=_tslClamp(_tslDiv(c-a,b-a),0.0,1.0);return t*t*(3.0-2.0*t);}',
      ...vecOverloads('_tslSmooth', 3),
    );
  }
  if (f.atan2) {
    out.push(
      'float _tslAtan2(float a,float b){return(abs(a)<1e-8&&abs(b)<1e-8)?0.0:atan(a,b);}',
      ...vecOverloads('_tslAtan2', 2),
    );
  }
  if (f.norm) {
    out.push(
      'float _tslNorm(float v){return abs(v)>1e-6?sign(v):0.0;}',
      ...VEC_TYS.map(
        ([, ty]) =>
          `${ty} _tslNorm(${ty} v){float l=length(v);return l>1e-6?v/l:${ty}(0.0);}`,
      ),
    );
  }
  if (f.snoise2 || f.snoise3 || f.voronoi2) {
    out.push(
      'float _tslM289(float x){return x-floor(x*(1.0/289.0))*289.0;}',
      'float _tslPerm(float x){return _tslM289((x*34.0+10.0)*x);}',
    );
  }
  if (f.snoise2) {
    out.push(
      'float _tslSNoise2(vec2 v){const float c0=0.21132487,c1=0.3660254,c2=-0.57735026,c3=0.024390243;float s=(v.x+v.y)*c1,ix=floor(v.x+s),iy=floor(v.y+s),t=(ix+iy)*c0,x0=v.x-ix+t,y0=v.y-iy+t,i1x=x0>y0?1.0:0.0,i1y=1.0-i1x,x1=x0+c0-i1x,y1=y0+c0-i1y,x2=x0+c2,y2=y0+c2;ix=_tslM289(ix);iy=_tslM289(iy);float p0=_tslPerm(_tslPerm(iy)+ix),p1=_tslPerm(_tslPerm(iy+i1y)+ix+i1x),p2=_tslPerm(_tslPerm(iy+1.0)+ix+1.0);vec3 m=max(0.5-vec3(x0*x0+y0*y0,x1*x1+y1*y1,x2*x2+y2*y2),0.0);m=m*m;m=m*m;vec3 gx=2.0*fract(vec3(p0,p1,p2)*c3)-1.0,hy=abs(gx)-0.5,ox=gx-floor(gx+0.5);m*=1.7928429-0.85373473*(ox*ox+hy*hy);return clamp(0.5+65.0*dot(m,ox*vec3(x0,x1,x2)+hy*vec3(y0,y1,y2)),0.0,1.0);}',
    );
  }
  if (f.snoise3) {
    out.push(
      'float _tslSNoise3(vec3 v){const float c0=0.16666667,c1=0.33333334,ns=0.14285715;float s=(v.x+v.y+v.z)*c1,i0=floor(v.x+s),i1=floor(v.y+s),i2=floor(v.z+s),t=(i0+i1+i2)*c0;vec3 p0=v-vec3(i0,i1,i2)+t,g=step(p0.yzx,p0.xyz),l=1.0-g.zxy,a1=min(g,l),a2=max(g,l),p1=p0-a1+c0,p2=p0-a2+c1,p3=p0-0.5;i0=_tslM289(i0);i1=_tslM289(i1);i2=_tslM289(i2);vec4 hs=vec4(_tslPerm(_tslPerm(_tslPerm(i2)+i1)+i0),_tslPerm(_tslPerm(_tslPerm(i2+a1.z)+i1+a1.y)+i0+a1.x),_tslPerm(_tslPerm(_tslPerm(i2+a2.z)+i1+a2.y)+i0+a2.x),_tslPerm(_tslPerm(_tslPerm(i2+1.0)+i1+1.0)+i0+1.0));float sum=0.0;for(int k=0;k<4;k++){float pk=hs[k],j=pk-49.0*floor(pk*ns*ns),x_=floor(j*ns),y_=floor(j-7.0*x_),gx=x_*(2.0/7.0)+(1.0/7.0)-1.0,gy=y_*(2.0/7.0)+(1.0/7.0)-1.0,gz=1.0-abs(gx)-abs(gy),sz=gz<0.0?1.0:0.0;gx-=sz*(gx>=0.0?1.0:-1.0);gy-=sz*(gy>=0.0?1.0:-1.0);float inv=1.7928429-0.85373473*(gx*gx+gy*gy+gz*gz);vec3 q=k==0?p0:(k==1?p1:(k==2?p2:p3));float m=max(0.6-dot(q,q),0.0);m=m*m;m=m*m;sum+=m*inv*(gx*q.x+gy*q.y+gz*q.z);}return clamp(0.5+21.0*sum,0.0,1.0);}',
    );
  }
  if (f.voronoi2) {
    out.push(
      'float _tslVoronoi2(vec2 u,float jit){vec2 n=floor(u),fr=u-n;float jt=clamp(jit,0.0,1.0),md=8.0;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){float qx=_tslM289(n.x+float(dx)),qy=_tslM289(n.y+float(dy)),hx=fract(_tslPerm(_tslPerm(qx)+qy)*(1.0/41.0)),hy=fract(_tslPerm(_tslPerm(qy+7.0)+qx+13.0)*(1.0/41.0));md=min(md,length(vec2(float(dx),float(dy))+0.5+(vec2(hx,hy)-0.5)*jt-fr));}return clamp(md,0.0,1.0);}',
    );
  }
  if (f.checker) {
    out.push(
      'float _tslChecker(vec2 p){return _tslMod(floor(p.x)+floor(p.y),2.0)>=1.0?1.0:0.0;}',
    );
  }
  if (f.fresnel) {
    out.push(
      'float _tslFresnel(float pw,vec3 nw,vec3 vd){return _tslPow(1.0-clamp(dot(_tslNorm(nw),_tslNorm(vd)),0.0,1.0),max(pw,1e-3));}',
    );
  }
  if (f.triplanar) {
    out.push(
      'float _tslTriplanar(vec3 p,float sh,vec3 nw){vec3 w=_tslPow(max(abs(_tslNorm(nw)),vec3(1e-4)),vec3(clamp(sh,0.5,16.0)));return(w.x*_tslSNoise2(p.yz)+w.y*_tslSNoise2(p.xz)+w.z*_tslSNoise2(p.xy))/max(w.x+w.y+w.z,1e-6);}',
    );
  }
  if (f.hueShift) {
    out.push(
      'vec3 _tslHueShift(vec3 rgb,float ang){const vec3 k=vec3(0.57735026);float c=cos(ang),s=sin(ang);return rgb*c+cross(k,rgb)*s+k*dot(k,rgb)*(1.0-c);}',
    );
  }
  if (f.bump && isFragment) {
    out.push(
      'vec3 _tslBump(float h,float st,vec3 nw,vec3 wp){vec3 n=_tslNorm(nw),dx=dFdx(wp),dy=dFdy(wp),r1=cross(dy,n),r2=cross(n,dx);float det=dot(dx,r1);return abs(det)<1e-8?n:_tslNorm(abs(det)*n-st*(det<0.0?-1.0:1.0)*(dFdx(h)*r1+dFdy(h)*r2));}',
    );
  }
  return out.join('\n');
}

const BUILTIN_VARS: Readonly<Record<string, string>> = {
  positionLocal: '_tslPL',
  positionWorld: '_tslPW',
  normalLocal: '_tslNL',
  normalWorld: '_tslNW',
  viewDirection: '_tslVD',
  uv: '_tslUV',
  vertexColor: '_tslVC',
  instanceIndex: '_tslII',
};

function emitGlslStatements(
  nodes: readonly ValidatedTslNode[],
  reachable: Uint8Array,
): string {
  const lines: string[] = [];
  const splat = (ty: TslType, e: string) =>
    ty === 'float' ? e : `${ty}(${e})`;
  const bc = (e: string, st: TslType, dt: TslType) =>
    st === dt ? e : `${dt}(${e})`;

  for (let i = 0; i < nodes.length; i++) {
    if (!reachable[i]) continue;
    const n = nodes[i];
    const ty = n.type;
    const a0 = n.args[0] !== undefined ? `_t${n.args[0]}` : '';
    const a1 = n.args[1] !== undefined ? `_t${n.args[1]}` : '';
    const a2 = n.args[2] !== undefined ? `_t${n.args[2]}` : '';
    const t0 = n.args[0] !== undefined ? nodes[n.args[0]].type : 'float';
    const t1 = n.args[1] !== undefined ? nodes[n.args[1]].type : 'float';
    const t2 = n.args[2] !== undefined ? nodes[n.args[2]].type : 'float';
    let expr = splat(ty, '0.0');

    switch (n.op) {
      case 'const': {
        const vs = (n.value ?? [0]).map(fmtShaderFloat);
        expr = ty === 'float' ? vs[0] : `${ty}(${vs.join(',')})`;
        break;
      }
      case 'builtin':
        expr =
          n.builtin === 'time'
            ? `_tslMod(uTslTime,${fmtShaderFloat(TSL_TIME_PERIOD_SEC)})`
            : (BUILTIN_VARS[n.builtin!] ?? '0.0');
        break;
      case 'uniform': {
        const s = `uTslParams[${n.uniformSlot ?? 0}]`;
        const ar = tslTypeArity(ty);
        expr = ar === 4 ? s : `${s}.${'xyz'.slice(0, ar)}`;
        break;
      }
      case 'swizzle':
        expr = t0 === 'float' ? splat(ty, a0) : `${a0}.${n.mask!}`;
        break;
      case 'construct':
        expr =
          ty === 'float'
            ? a0
            : `${ty}(${n.args.map((ai) => `_t${ai}`).join(',')})`;
        break;
      case 'neg':
        expr = `(-${a0})`;
        break;
      case 'abs':
      case 'sign':
      case 'floor':
      case 'ceil':
      case 'fract':
      case 'sin':
      case 'cos':
        expr = `${n.op}(${a0})`;
        break;
      case 'sqrt':
        expr = `sqrt(max(${a0},${splat(ty, '0.0')}))`;
        break;
      case 'exp':
        expr = `exp(clamp(${a0},${splat(ty, '-80.0')},${splat(ty, '80.0')}))`;
        break;
      case 'log':
        expr = `log(max(${a0},${splat(ty, '1.0e-8')}))`;
        break;
      case 'normalize':
        expr = `_tslNorm(${a0})`;
        break;
      case 'add':
      case 'sub':
      case 'mul': {
        const sym = n.op === 'add' ? '+' : n.op === 'sub' ? '-' : '*';
        expr = `(${bc(a0, t0, ty)}${sym}${bc(a1, t1, ty)})`;
        break;
      }
      case 'div':
      case 'mod':
      case 'pow':
      case 'atan2': {
        const fn =
          n.op === 'div'
            ? '_tslDiv'
            : n.op === 'mod'
              ? '_tslMod'
              : n.op === 'pow'
                ? '_tslPow'
                : '_tslAtan2';
        expr = `${fn}(${bc(a0, t0, ty)},${bc(a1, t1, ty)})`;
        break;
      }
      case 'min':
      case 'max':
      case 'step':
        expr = `${n.op}(${bc(a0, t0, ty)},${bc(a1, t1, ty)})`;
        break;
      case 'clamp':
        expr = `_tslClamp(${bc(a0, t0, ty)},${bc(a1, t1, ty)},${bc(a2, t2, ty)})`;
        break;
      case 'mix':
        expr = `mix(${a0},${a1},${bc(a2, t2, ty)})`;
        break;
      case 'smoothstep':
        expr = `_tslSmooth(${bc(a0, t0, ty)},${bc(a1, t1, ty)},${bc(a2, t2, ty)})`;
        break;
      case 'dot':
        expr = t0 === 'float' ? `(${a0}*${a1})` : `dot(${a0},${a1})`;
        break;
      case 'length':
        expr = t0 === 'float' ? `abs(${a0})` : `length(${a0})`;
        break;
      case 'distance':
        expr = t0 === 'float' ? `abs(${a0}-${a1})` : `distance(${a0},${a1})`;
        break;
      case 'cross':
      case 'reflect':
        expr = `${n.op}(${a0},${a1})`;
        break;
      case 'fresnel':
        expr = `_tslFresnel(${a0},_tslNW,_tslVD)`;
        break;
      case 'simplexNoise2D':
        expr = `_tslSNoise2(${a0})`;
        break;
      case 'simplexNoise3D':
        expr = `_tslSNoise3(${a0})`;
        break;
      case 'voronoi2D':
        expr = `_tslVoronoi2(${a0},${a1})`;
        break;
      case 'checker':
        expr = `_tslChecker(${a0})`;
        break;
      case 'triplanar':
        expr = `_tslTriplanar(${a0},${a1},_tslNW)`;
        break;
      case 'hueShift':
        expr = `_tslHueShift(${a0},${a1})`;
        break;
      case 'bumpFromHeight':
        expr = `_tslBump(${a0},${a1},_tslNW,_tslPW)`;
        break;
      default:
        break;
    }
    lines.push(`${ty} _t${i}=${expr};`);
  }
  return lines.join('\n');
}

/** Compiles `graph` and splices it into `ThreeView`'s `VS_RENDER` & `FS_RENDER`. */
export function compileTslToGlsl(
  graph: ValidatedTslGraph,
  baseVS: string,
  baseFS: string,
): {vs: string; fs: string} {
  const uniformDecls = `uniform vec4 uTslParams[${MAX_TSL_UNIFORMS}];\nuniform float uTslTime;`;
  const hasFrag = graph.fragmentReachable.some((r) => r === 1);

  let vs = baseVS.replace(
    'out vec2 vUV;',
    `${uniformDecls}\nout vec2 vUV;\nout vec3 vTslLP,vTslLN;\nflat out float vTslII;`,
  );
  const posVar = vs.includes('morphedPos') ? 'morphedPos' : 'aPosition';

  if (graph.usesVertexPosition && graph.outputs.position !== undefined) {
    const vHelpers = emitGlslHelpers(
      scanTslHelpers(graph.nodes, graph.vertexReachable, graph.usesTime),
      false,
    );
    const vBody = emitGlslStatements(graph.nodes, graph.vertexReachable);
    const posFn = `${vHelpers}
vec3 _tslEvalPos(vec3 _tslPL,vec3 _tslNL,vec2 _tslUV,vec4 _tslVC,float _tslII,mat4 _m,mat3 _nm){
vec3 _tslPW=(_m*vec4(_tslPL,1.0)).xyz,_rn=_nm*_tslNL,_tslNW=length(_rn)>1e-5?normalize(_rn):vec3(0.0,1.0,0.0),_tslVD=vec3(0.0,0.0,1.0);
${vBody}
return _t${graph.outputs.position};}`;
    vs = vs.replace('void main(){', `${posFn}\nvoid main(){`);

    const dispBlock = `vec2 _tslScUV=uUvTransform.zw;if(_tslScUV.x==0.0&&_tslScUV.y==0.0)_tslScUV=vec2(1.0);vec2 _tslVtxUV=aUV*_tslScUV+uUvTransform.xy;
float _tslInstF=float(gl_InstanceID);vec3 _tslBaseP=${posVar},_tslNewP=_tslEvalPos(_tslBaseP,aNormal,_tslVtxUV,vInstTint,_tslInstF,uModel,uNormalMatrix),_tslNewN=aNormal;
if(length(aNormal)>1e-4){vec3 _n0=normalize(aNormal),_tg1=normalize(abs(_n0.y)<0.99?cross(vec3(0.0,1.0,0.0),_n0):cross(vec3(1.0,0.0,0.0),_n0)),_tg2=cross(_n0,_tg1),_cn=cross(_tslEvalPos(_tslBaseP+_tg1*1e-3,aNormal,_tslVtxUV,vInstTint,_tslInstF,uModel,uNormalMatrix)-_tslNewP,_tslEvalPos(_tslBaseP+_tg2*1e-3,aNormal,_tslVtxUV,vInstTint,_tslInstF,uModel,uNormalMatrix)-_tslNewP);if(length(_cn)>1e-10)_tslNewN=normalize(_cn);}
vTslLP=_tslNewP;vTslLN=_tslNewN;vTslII=_tslInstF;vec3 _rnDisp=uNormalMatrix*_tslNewN;vNormal=length(_rnDisp)>1e-5?normalize(_rnDisp):vec3(0.0);`;

    if (vs.includes(`vec4 world=uModel*(skinMatrix*vec4(${posVar},1.0));`)) {
      vs = vs
        .replace(
          `vec4 world=uModel*(skinMatrix*vec4(${posVar},1.0));`,
          `${dispBlock}\nvec4 world=uModel*(skinMatrix*vec4(_tslNewP,1.0));`,
        )
        .replace(
          `gl_Position=uMVP*(skinMatrix*vec4(${posVar},1.0));`,
          'gl_Position=uMVP*(skinMatrix*vec4(_tslNewP,1.0));',
        );
    } else {
      vs = vs
        .replace(
          `vec4 world=uModel*vec4(${posVar},1.0);`,
          `${dispBlock}\nvec4 world=uModel*vec4(_tslNewP,1.0);`,
        )
        .replace(
          `gl_Position=uMVP*vec4(${posVar},1.0);`,
          'gl_Position=uMVP*vec4(_tslNewP,1.0);',
        );
    }
  } else {
    vs = vs.replace(
      'gl_Position=',
      `vTslLP=${posVar};vTslLN=aNormal;vTslII=float(gl_InstanceID);\ngl_Position=`,
    );
  }

  let fs = baseFS.replace(
    'in vec2 vUV;',
    `${uniformDecls}\nin vec2 vUV;\nin vec3 vTslLP,vTslLN;\nflat in float vTslII;`,
  );

  if (hasFrag) {
    const fHelpers = emitGlslHelpers(
      scanTslHelpers(graph.nodes, graph.fragmentReachable, graph.usesTime),
      true,
    );
    const fBody = emitGlslStatements(graph.nodes, graph.fragmentReachable);
    if (fHelpers) fs = fs.replace('void main(){', `${fHelpers}\nvoid main(){`);
    if (graph.outputs.opacity !== undefined) {
      fs = fs.replace('if(base.a<0.004)discard;', '');
    }
    fs = fs.replace(
      'if(length(vNormal)<1e-4&&uHasTexture==1){',
      'if(false&&length(vNormal)<1e-4&&uHasTexture==1){',
    );

    const sa: string[] = [];
    if (graph.outputs.color !== undefined) {
      sa.push(
        `base.rgb=max(_t${graph.outputs.color},vec3(0.0))*vInstTint.rgb;`,
      );
    }
    if (graph.outputs.opacity !== undefined) {
      sa.push(
        `base.a=clamp(_t${graph.outputs.opacity},0.0,1.0)*vInstTint.a;`,
        'if(base.a<0.004)discard;',
      );
    }
    if (graph.outputs.emissive !== undefined) {
      sa.push(`em=max(_t${graph.outputs.emissive},vec3(0.0));`);
    }
    if (graph.outputs.roughness !== undefined) {
      sa.push(`roughness=clamp(_t${graph.outputs.roughness},0.04,1.0);`);
    }
    if (graph.outputs.metalness !== undefined) {
      sa.push(`metallic=clamp(_t${graph.outputs.metalness},0.0,1.0);`);
    }
    if (
      graph.outputs.normalScale !== undefined &&
      graph.outputs.bump === undefined
    ) {
      fs = fs.replace(
        'if(uHasNormalTexture==1){',
        'vec3 _tslBaseN=N;\nif(uHasNormalTexture==1){',
      );
      sa.push(
        `if(uHasNormalTexture==1){N=perturbNormal(_tslBaseN,V,vUV,uNormalTexture,max(_t${graph.outputs.normalScale},0.0));}`,
      );
    }
    if (graph.outputs.bump !== undefined) {
      const nsExpr =
        graph.outputs.normalScale !== undefined
          ? `max(_t${graph.outputs.normalScale},0.0)`
          : '1.0';
      sa.push(
        `{vec3 _bn=_t${graph.outputs.bump};float _bl=length(_bn);if(_bl>1e-6){vec3 _bm=N+(_bn/_bl-N)*(${nsExpr});float _ml=length(_bm);if(_ml>1e-6)N=_bm/_ml;}}`,
      );
    }

    fs = fs.replace(
      'metallic=clamp(metallic,0.0,1.0);',
      `metallic=clamp(metallic,0.0,1.0);\n{vec3 _tslPL=vTslLP,_tslPW=vWorldPos,_tslNL=length(vTslLN)>1e-5?normalize(vTslLN):vec3(0.0,1.0,0.0),_tslNW=N,_tslVD=V;vec2 _tslUV=vUV;vec4 _tslVC=vInstTint;float _tslII=vTslII;\n${fBody}\n${sa.join('\n')}}`,
    );
  }

  return {vs, fs};
}
