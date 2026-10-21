/* Picking after a pole crossing. The app's exact chain is:
     geoAt(px,py) = unrotM(FRAME, unproject(plane))  and the draw is
     projectRotLL(that point, FRAME). They must round-trip.
   unproject() uses CUR (set it!) and returns DEGREES of the rotated frame;
   unrotM wants RADIANS, hence the *DEG in geoAt. The old code used the CANONICAL
   unrot(view.lon, view.lat, ...), which after a crossing answers a point off by
   the accumulated roll (hover/pick land on the wrong country). */
const fs=require('fs');const C=new Function(fs.readFileSync('./core.js','utf8')+'\nreturn CORE;')();
const D=Math.PI/180;
const F=new Float64Array(9),F2=new Float64Array(9),cen=[0,0];
for(const which of ['ortho','persp']){
  C.setProjection(which);
  const proj=C.PROJ[which];
  const ext=proj.extent[0];
  C.rotMat(0,80,F);
  for(let s=0;s<30;s++){                       // walk over the pole, app's pan math
    const ll=C.unproject(0,0.05*ext);
    const g=C.unrotM(F,ll[0]*D,ll[1]*D);
    C.rotFrom(F,g[0],g[1],F2);
    for(let i=0;i<9;i++)F[i]=F2[i];
  }
  const c=C.frameCentre(F,cen);
  let wNew=0,wOld=0,tries=0;
  for(let t=0;t<3000;t++){
    const x=(Math.random()*2-1)*ext*0.9,y=(Math.random()*2-1)*ext*0.9;
    const u=C.unproject(x,y); if(!u)continue; tries++;
    const g=C.unrotM(F,u[0]*D,u[1]*D);
    const o=C.projectRotLL(g[0],g[1],F,proj,[0,0]);
    wNew=Math.max(wNew,Math.hypot(o[0]-x,o[1]-y)/ext);
    const gc=C.unrot(c[0],c[1],u[0]*D,u[1]*D);          // what the OLD code did
    const oc=C.projectRotLL(gc[0],gc[1],F,proj,[0,0]);
    wOld=Math.max(wOld,Math.hypot(oc[0]-x,oc[1]-y)/ext);
  }
  console.log(which+' centre after crossing '+c.map(v=>v.toFixed(3)).join(',')+
    ': unrotM round trip worst '+(wNew*100).toExponential(1)+' % of frame,'+
    ' canonical unrot would miss by up to '+(wOld*100).toFixed(1)+' % ('+tries+' pts)');
}
