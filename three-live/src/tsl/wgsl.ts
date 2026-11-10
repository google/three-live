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
 * @fileoverview Loop-Free TSL (`extras.tsl`) -> WebGPU WGSL Compiler.
 */

import type {CompiledTslWgsl} from '../plugin';
import {fmtShaderFloat, scanTslHelpers, type TslHelperFlags} from './glsl';
import {
  MAX_TSL_UNIFORMS,
  TSL_TIME_PERIOD_SEC,
  tslTypeArity,
  type TslType,
  type ValidatedTslGraph,
  type ValidatedTslNode,
} from './ir';

/** Byte size of `TslUniformBlock` (`16 * vec4<f32> + vec4<f32> = 272 B`). */
export const TSL_WGSL_UNIFORM_BYTES = 272;

const COMPS = ['x', 'y', 'z', 'w'] as const;
const WVEC_TYS: ReadonlyArray<[number, string]> = [
  [2, 'vec2<f32>'],
  [3, 'vec3<f32>'],
  [4, 'vec4<f32>'],
];

function wgslVecOverloads(base: string, arityArgs: 2 | 3): string[] {
  return WVEC_TYS.map(([n, ty]) => {
    const calls = COMPS.slice(0, n)
      .map((c) =>
        arityArgs === 2
          ? `${base}1(a.${c},b.${c})`
          : `${base}1(a.${c},b.${c},c.${c})`,
      )
      .join(',');
    return arityArgs === 2
      ? `fn ${base}${n}(a:${ty},b:${ty})->${ty}{return ${ty}(${calls});}`
      : `fn ${base}${n}(a:${ty},b:${ty},c:${ty})->${ty}{return ${ty}(${calls});}`;
  });
}

function emitWgslHelpers(f: TslHelperFlags, isFragment: boolean): string {
  const out: string[] = [];
  if (f.div) {
    out.push(
      'fn _tslDiv1(a:f32,b:f32)->f32{return a/select(b,select(1e-6,-1e-6,b<0.0),abs(b)<1e-6);}',
      ...wgslVecOverloads('_tslDiv', 2),
    );
  }
  if (f.mod) {
    out.push(
      'fn _tslMod1(a:f32,b:f32)->f32{let d=select(b,select(1e-6,-1e-6,b<0.0),abs(b)<1e-6);return a-d*floor(a/d);}',
      ...wgslVecOverloads('_tslMod', 2),
    );
  }
  if (f.pow) {
    out.push(
      'fn _tslPow1(a:f32,b:f32)->f32{let e=clamp(b,-64.0,64.0);if(abs(e)<1e-8){return 1.0;}if(a<=0.0){return 0.0;}return pow(max(a,1e-8),e);}',
      ...wgslVecOverloads('_tslPow', 2),
    );
  }
  if (f.clamp) {
    out.push(
      'fn _tslClamp1(a:f32,b:f32,c:f32)->f32{return clamp(a,min(b,c),max(b,c));}',
      ...wgslVecOverloads('_tslClamp', 3),
    );
  }
  if (f.smooth) {
    out.push(
      'fn _tslSmooth1(a:f32,b:f32,c:f32)->f32{let t=_tslClamp1(_tslDiv1(c-a,b-a),0.0,1.0);return t*t*(3.0-2.0*t);}',
      ...wgslVecOverloads('_tslSmooth', 3),
    );
  }
  if (f.atan2) {
    out.push(
      'fn _tslAtan1(a:f32,b:f32)->f32{return select(atan2(a,b),0.0,abs(a)<1e-8&&abs(b)<1e-8);}',
      ...wgslVecOverloads('_tslAtan', 2),
    );
  }
  if (f.norm) {
    out.push(
      'fn _tslNorm1(v:f32)->f32{return select(0.0,sign(v),abs(v)>1e-6);}',
      ...WVEC_TYS.map(
        ([n, ty]) =>
          `fn _tslNorm${n}(v:${ty})->${ty}{let l=length(v);return select(${ty}(0.0),v/l,l>1e-6);}`,
      ),
    );
  }
  if (f.snoise2 || f.snoise3 || f.voronoi2) {
    out.push(
      'fn _tslM289(x:f32)->f32{return x-floor(x*(1.0/289.0))*289.0;}',
      'fn _tslPerm(x:f32)->f32{return _tslM289((x*34.0+10.0)*x);}',
    );
  }
  if (f.snoise2) {
    out.push(
      'fn _tslSNoise2(v:vec2<f32>)->f32{let c0=0.21132487;let c1=0.3660254;let c2=-0.57735026;let c3=0.024390243;let s=(v.x+v.y)*c1;var ix=floor(v.x+s);var iy=floor(v.y+s);let t=(ix+iy)*c0;let x0=v.x-ix+t;let y0=v.y-iy+t;let i1x=select(0.0,1.0,x0>y0);let i1y=1.0-i1x;let x1=x0+c0-i1x;let y1=y0+c0-i1y;let x2=x0+c2;let y2=y0+c2;ix=_tslM289(ix);iy=_tslM289(iy);let p0=_tslPerm(_tslPerm(iy)+ix);let p1=_tslPerm(_tslPerm(iy+i1y)+ix+i1x);let p2=_tslPerm(_tslPerm(iy+1.0)+ix+1.0);var m=max(vec3<f32>(0.5)-vec3<f32>(x0*x0+y0*y0,x1*x1+y1*y1,x2*x2+y2*y2),vec3<f32>(0.0));m=m*m;m=m*m;let gx=2.0*fract(vec3<f32>(p0,p1,p2)*c3)-vec3<f32>(1.0);let hy=abs(gx)-vec3<f32>(0.5);let ox=gx-floor(gx+vec3<f32>(0.5));m*=vec3<f32>(1.7928429)-0.85373473*(ox*ox+hy*hy);return clamp(0.5+65.0*dot(m,ox*vec3<f32>(x0,x1,x2)+hy*vec3<f32>(y0,y1,y2)),0.0,1.0);}',
    );
  }
  if (f.snoise3) {
    out.push(
      'fn _tslSNoise3(v:vec3<f32>)->f32{let c0=0.16666667;let c1=0.33333334;let ns=0.14285715;let s=(v.x+v.y+v.z)*c1;var i0=floor(v.x+s);var i1=floor(v.y+s);var i2=floor(v.z+s);let t=(i0+i1+i2)*c0;let p0=v-vec3<f32>(i0,i1,i2)+vec3<f32>(t);let g=step(p0.yzx,p0.xyz);let l=vec3<f32>(1.0)-g.zxy;let a1=min(g,l);let a2=max(g,l);let p1=p0-a1+vec3<f32>(c0);let p2=p0-a2+vec3<f32>(c1);let p3=p0-vec3<f32>(0.5);i0=_tslM289(i0);i1=_tslM289(i1);i2=_tslM289(i2);let hs=array<f32,4>(_tslPerm(_tslPerm(_tslPerm(i2)+i1)+i0),_tslPerm(_tslPerm(_tslPerm(i2+a1.z)+i1+a1.y)+i0+a1.x),_tslPerm(_tslPerm(_tslPerm(i2+a2.z)+i1+a2.y)+i0+a2.x),_tslPerm(_tslPerm(_tslPerm(i2+1.0)+i1+1.0)+i0+1.0));let qs=array<vec3<f32>,4>(p0,p1,p2,p3);var sum=0.0;for(var k=0;k<4;k=k+1){let pk=hs[k];let j=pk-49.0*floor(pk*ns*ns);let x_=floor(j*ns);let y_=floor(j-7.0*x_);var gx=x_*(2.0/7.0)+(1.0/7.0)-1.0;var gy=y_*(2.0/7.0)+(1.0/7.0)-1.0;let gz=1.0-abs(gx)-abs(gy);let sz=select(0.0,1.0,gz<0.0);gx-=sz*select(-1.0,1.0,gx>=0.0);gy-=sz*select(-1.0,1.0,gy>=0.0);let inv=1.7928429-0.85373473*(gx*gx+gy*gy+gz*gz);let q=qs[k];var m=max(0.6-dot(q,q),0.0);m=m*m;m=m*m;sum+=m*inv*(gx*q.x+gy*q.y+gz*q.z);}return clamp(0.5+21.0*sum,0.0,1.0);}',
    );
  }
  if (f.voronoi2) {
    out.push(
      'fn _tslVoronoi2(u:vec2<f32>,jit:f32)->f32{let n=floor(u);let fr=u-n;let jt=clamp(jit,0.0,1.0);var md=8.0;for(var dy=-1;dy<=1;dy=dy+1){for(var dx=-1;dx<=1;dx=dx+1){let qx=_tslM289(n.x+f32(dx));let qy=_tslM289(n.y+f32(dy));let hx=fract(_tslPerm(_tslPerm(qx)+qy)*(1.0/41.0));let hy=fract(_tslPerm(_tslPerm(qy+7.0)+qx+13.0)*(1.0/41.0));md=min(md,length(vec2<f32>(f32(dx),f32(dy))+vec2<f32>(0.5)+(vec2<f32>(hx,hy)-vec2<f32>(0.5))*jt-fr));}}return clamp(md,0.0,1.0);}',
    );
  }
  if (f.checker) {
    out.push(
      'fn _tslChecker(p:vec2<f32>)->f32{return select(0.0,1.0,_tslMod1(floor(p.x)+floor(p.y),2.0)>=1.0);}',
    );
  }
  if (f.fresnel) {
    out.push(
      'fn _tslFresnel(pw:f32,nw:vec3<f32>,vd:vec3<f32>)->f32{return _tslPow1(1.0-clamp(dot(_tslNorm3(nw),_tslNorm3(vd)),0.0,1.0),max(pw,1e-3));}',
    );
  }
  if (f.triplanar) {
    out.push(
      'fn _tslTriplanar(p:vec3<f32>,sh:f32,nw:vec3<f32>)->f32{let w=_tslPow3(max(abs(_tslNorm3(nw)),vec3<f32>(1e-4)),vec3<f32>(clamp(sh,0.5,16.0)));return(w.x*_tslSNoise2(p.yz)+w.y*_tslSNoise2(p.xz)+w.z*_tslSNoise2(p.xy))/max(w.x+w.y+w.z,1e-6);}',
    );
  }
  if (f.hueShift) {
    out.push(
      'fn _tslHueShift(rgb:vec3<f32>,ang:f32)->vec3<f32>{let k=vec3<f32>(0.57735026);let c=cos(ang);let s=sin(ang);return rgb*c+cross(k,rgb)*s+k*dot(k,rgb)*(1.0-c);}',
    );
  }
  if (f.bump && isFragment) {
    out.push(
      'fn _tslBump(dhx:f32,dhy:f32,st:f32,nw:vec3<f32>,dx:vec3<f32>,dy:vec3<f32>)->vec3<f32>{let n=_tslNorm3(nw);let r1=cross(dy,n);let r2=cross(n,dx);let det=dot(dx,r1);if(abs(det)<1e-8){return n;}return _tslNorm3(abs(det)*n-st*select(1.0,-1.0,det<0.0)*(dhx*r1+dhy*r2));}',
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

function emitWgslStatements(
  nodes: readonly ValidatedTslNode[],
  reachable: Uint8Array,
): string {
  const lines: string[] = [];
  const wTy = (ty: TslType) => (ty === 'float' ? 'f32' : `${ty}<f32>`);
  const splat = (ty: TslType, e: string) =>
    ty === 'float' ? e : `${ty}<f32>(${e})`;
  const bc = (e: string, st: TslType, dt: TslType) =>
    st === dt ? e : `${dt}<f32>(${e})`;

  for (let i = 0; i < nodes.length; i++) {
    if (!reachable[i]) continue;
    const n = nodes[i];
    const ty = n.type;
    const ar = tslTypeArity(ty);
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
        expr = ty === 'float' ? vs[0] : `${ty}<f32>(${vs.join(',')})`;
        break;
      }
      case 'builtin':
        expr =
          n.builtin === 'time'
            ? `_tslMod1(tslU.timeAndPad.x,${fmtShaderFloat(TSL_TIME_PERIOD_SEC)})`
            : (BUILTIN_VARS[n.builtin!] ?? '0.0');
        break;
      case 'uniform': {
        const s = `tslU.params[${n.uniformSlot ?? 0}]`;
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
            : `${ty}<f32>(${n.args.map((ai) => `_t${ai}`).join(',')})`;
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
        expr = `_tslNorm${ar}(${a0})`;
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
                : '_tslAtan';
        expr = `${fn}${ar}(${bc(a0, t0, ty)},${bc(a1, t1, ty)})`;
        break;
      }
      case 'min':
      case 'max':
      case 'step':
        expr = `${n.op}(${bc(a0, t0, ty)},${bc(a1, t1, ty)})`;
        break;
      case 'clamp':
        expr = `_tslClamp${ar}(${bc(a0, t0, ty)},${bc(a1, t1, ty)},${bc(a2, t2, ty)})`;
        break;
      case 'mix':
        expr = `mix(${a0},${a1},${bc(a2, t2, ty)})`;
        break;
      case 'smoothstep':
        expr = `_tslSmooth${ar}(${bc(a0, t0, ty)},${bc(a1, t1, ty)},${bc(a2, t2, ty)})`;
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
        expr = `_tslBump(dpdx(${a0}),-dpdy(${a0}),${a1},_tslNW,p1,p2)`;
        break;
      default:
        break;
    }
    lines.push(`  let _t${i}:${wTy(ty)}=${expr};`);
  }
  return lines.join('\n');
}

/** Compiles `graph` into WGSL shaders for `three-live-webgpu`. */
export function compileTslToWgsl(
  graph: ValidatedTslGraph,
  basePbrWgsl: string,
  baseShadowDepthWgsl: string,
): CompiledTslWgsl {
  const tslBlockStruct = `struct TslUniformBlock{params:array<vec4<f32>,${MAX_TSL_UNIFORMS}>,timeAndPad:vec4<f32>,};\n`;
  const anyReach = new Uint8Array(graph.nodes.length);
  for (let i = 0; i < graph.nodes.length; i++) {
    anyReach[i] = graph.fragmentReachable[i] || graph.vertexReachable[i];
  }
  const hasFrag = graph.fragmentReachable.some((r) => r === 1);
  const pbrHelpers = emitWgslHelpers(
    scanTslHelpers(graph.nodes, anyReach, graph.usesTime),
    true,
  );

  let pbrWgsl = basePbrWgsl
    .replace(
      '@group(1) @binding(4) var emTex: texture_2d<f32>;',
      `@group(1) @binding(4) var emTex: texture_2d<f32>;\n${tslBlockStruct}@group(2) @binding(0) var<uniform> tslU: TslUniformBlock;`,
    )
    .replace(
      '@location(3) @interpolate(flat) instIdx: u32,',
      '@location(3) @interpolate(flat) instIdx: u32,\n  @location(4) localPos: vec3<f32>,\n  @location(5) localNorm: vec3<f32>,',
    )
    .replace(
      'out.instIdx = instIdx;\n    return out;',
      'out.instIdx = instIdx;\n    out.localPos = vec3<f32>(0.0);\n    out.localNorm = vec3<f32>(0.0, 1.0, 0.0);\n    return out;',
    );

  if (pbrHelpers) {
    pbrWgsl = pbrWgsl.replace('@vertex', `${pbrHelpers}\n@vertex`);
  }

  if (graph.usesVertexPosition && graph.outputs.position !== undefined) {
    const vBody = emitWgslStatements(graph.nodes, graph.vertexReachable);
    const evalPosFn = `fn _tslEvalPos(_tslPL:vec3<f32>,_tslNL:vec3<f32>,_tslUV:vec2<f32>,_tslVC:vec4<f32>,_tslII:f32,m:mat4x4<f32>)->vec3<f32>{
  let _tslPW=(m*vec4<f32>(_tslPL,1.0)).xyz;let _rn=m[0].xyz*_tslNL.x+m[1].xyz*_tslNL.y+m[2].xyz*_tslNL.z;let _rl=length(_rn);
  let _tslNW=select(vec3<f32>(0.0,1.0,0.0),_rn/_rl,_rl>1e-5);let _tslVD=vec3<f32>(0.0,0.0,1.0);
${vBody}
  return _t${graph.outputs.position};}`;
    pbrWgsl = pbrWgsl
      .replace('@vertex', `${evalPosFn}\n@vertex`)
      .replace(
        'let world = m * vec4<f32>(aPos, 1.0);',
        `let _tslInstF=f32(instIdx);let _tslNewP=_tslEvalPos(aPos,aNormal,aUV,vec4<f32>(1.0),_tslInstF,m);var _tslNewN=aNormal;
  if(length(aNormal)>1e-4){let _n0=normalize(aNormal);let _tg1=normalize(select(cross(vec3<f32>(1.0,0.0,0.0),_n0),cross(vec3<f32>(0.0,1.0,0.0),_n0),abs(_n0.y)<0.99));let _tg2=cross(_n0,_tg1);let _cn=cross(_tslEvalPos(aPos+_tg1*1e-3,aNormal,aUV,vec4<f32>(1.0),_tslInstF,m)-_tslNewP,_tslEvalPos(aPos+_tg2*1e-3,aNormal,aUV,vec4<f32>(1.0),_tslInstF,m)-_tslNewP);if(length(_cn)>1e-10){_tslNewN=normalize(_cn);}}
  let world = m * vec4<f32>(_tslNewP, 1.0);`,
      )
      .replace(
        'rawN = (adj0 * aNormal.x + adj1 * aNormal.y + adj2 * aNormal.z) * sgn;\n  } else {\n    rawN = c0 * aNormal.x + c1 * aNormal.y + c2 * aNormal.z;',
        'rawN = (adj0 * _tslNewN.x + adj1 * _tslNewN.y + adj2 * _tslNewN.z) * sgn;\n  } else {\n    rawN = c0 * _tslNewN.x + c1 * _tslNewN.y + c2 * _tslNewN.z;',
      )
      .replace(
        'out.instIdx = instIdx;\n  return out;',
        'out.instIdx = instIdx;\n  out.localPos = _tslNewP;\n  out.localNorm = _tslNewN;\n  return out;',
      );
  } else {
    pbrWgsl = pbrWgsl.replace(
      'out.instIdx = instIdx;\n  return out;',
      'out.instIdx = instIdx;\n  out.localPos = aPos;\n  out.localNorm = aNormal;\n  return out;',
    );
  }

  if (hasFrag) {
    const fBody = emitWgslStatements(graph.nodes, graph.fragmentReachable);
    const uniformEval = `  let _nL=length(in.normal);var _nU:vec3<f32>;if(_nL<1e-4){let _fc=cross(p1,p2);let _fl=length(_fc);_nU=select(vec3<f32>(0.0,1.0,0.0),_fc/_fl,_fl>1e-8);}else{_nU=in.normal/_nL;}if(!frontFacing){_nU=-_nU;}
  let _toC=sc.camAndExp.xyz-in.worldPos;let _cD=length(_toC);let _tslVD=select(vec3<f32>(0.0,0.0,1.0),_toC/_cD,_cD>1e-6);let _tslNW=_nU;
  let _lnL=length(in.localNorm);let _tslNL=select(vec3<f32>(0.0,1.0,0.0),in.localNorm/_lnL,_lnL>1e-5);let _tslPL=in.localPos;let _tslPW=in.worldPos;let _tslUV=in.uv;let _tslVC=vec4<f32>(1.0);let _tslII=f32(in.instIdx);
${fBody}`;

    pbrWgsl = pbrWgsl.replace(
      'let emTexel = textureSample(emTex, linSampler, in.uv);',
      `let emTexel = textureSample(emTex, linSampler, in.uv);\n${uniformEval}`,
    );

    if (graph.outputs.opacity !== undefined) {
      pbrWgsl = pbrWgsl.replace(
        'if (base.a < 0.004) {\n    discard;\n  }',
        `base.a = clamp(_t${graph.outputs.opacity}, 0.0, 1.0);\n  if (base.a < 0.004) {\n    discard;\n  }`,
      );
    }

    pbrWgsl = pbrWgsl.replace(
      'if (nInLen < 1e-4 && (pFlags & 2u) != 0u) {',
      'if (false && nInLen < 1e-4 && (pFlags & 2u) != 0u) {',
    );

    if (
      graph.outputs.normalScale !== undefined &&
      graph.outputs.bump === undefined
    ) {
      pbrWgsl = pbrWgsl.replace(
        'q = vec3<f32>(q.xy * p.aux.x, q.z);',
        `q = vec3<f32>(q.xy * max(_t${graph.outputs.normalScale}, 0.0), q.z);`,
      );
    }
    const pa: string[] = [];
    if (graph.outputs.color !== undefined) {
      pa.push(
        `  base=vec4<f32>(max(_t${graph.outputs.color},vec3<f32>(0.0)),base.a);`,
      );
    }
    if (graph.outputs.emissive !== undefined) {
      pa.push(`  em=max(_t${graph.outputs.emissive},vec3<f32>(0.0));`);
    }
    if (graph.outputs.roughness !== undefined) {
      pa.push(`  roughness=clamp(_t${graph.outputs.roughness},0.04,1.0);`);
    }
    if (graph.outputs.metalness !== undefined) {
      pa.push(`  metallic=clamp(_t${graph.outputs.metalness},0.0,1.0);`);
    }
    if (graph.outputs.bump !== undefined) {
      const nsExpr =
        graph.outputs.normalScale !== undefined
          ? `max(_t${graph.outputs.normalScale},0.0)`
          : '1.0';
      pa.push(
        `  let _bn=_t${graph.outputs.bump};let _bl=length(_bn);if(_bl>1e-6){let _bm=N+(_bn/_bl-N)*(${nsExpr});let _ml=length(_bm);if(_ml>1e-6){N=_bm/_ml;}}`,
      );
    }
    if (pa.length > 0) {
      pbrWgsl = pbrWgsl.replace(
        'metallic = clamp(metallic, 0.0, 1.0);',
        `metallic = clamp(metallic, 0.0, 1.0);\n${pa.join('\n')}`,
      );
    }
  }

  let shadowDepthWgsl: string | null = null;
  if (graph.usesVertexPosition && graph.outputs.position !== undefined) {
    const shHelpers = emitWgslHelpers(
      scanTslHelpers(graph.nodes, graph.vertexReachable, graph.usesTime),
      false,
    );
    const vBody = emitWgslStatements(graph.nodes, graph.vertexReachable);
    shadowDepthWgsl = baseShadowDepthWgsl
      .replace(
        '@group(0) @binding(1) var<storage, read> parts: array<PartInstance>;',
        `@group(0) @binding(1) var<storage, read> parts: array<PartInstance>;\n${tslBlockStruct}@group(1) @binding(0) var<uniform> tslU: TslUniformBlock;\n${shHelpers}`,
      )
      .replace(
        '@location(1) aNormal: vec3<f32>,',
        '@location(1) aNormal: vec3<f32>,\n  @location(2) aUV: vec2<f32>,',
      )
      .replace(
        'var wp = m * vec4<f32>(aPos, 1.0);',
        `let _tslPL=aPos;let _tslPW=(m*vec4<f32>(aPos,1.0)).xyz;let _tslNL=aNormal;let _rn=m[0].xyz*aNormal.x+m[1].xyz*aNormal.y+m[2].xyz*aNormal.z;let _rl=length(_rn);let _tslNW=select(vec3<f32>(0.0,1.0,0.0),_rn/_rl,_rl>1e-5);let _tslVD=vec3<f32>(0.0,0.0,1.0);let _tslUV=aUV;let _tslVC=vec4<f32>(1.0);let _tslII=f32(instIdx);\n${vBody}\n  var wp = m * vec4<f32>(_t${graph.outputs.position}, 1.0);`,
      );
  }

  return {hash: graph.hash, pbrWgsl, shadowDepthWgsl};
}
