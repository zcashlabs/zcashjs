// Only this page's exact worker URLs and owning window realms count.
export function ownedLifecycle(events, origin, scripts) {
  const windows=new Set(events.filter(e=>e.method==='script.realmCreated'&&e.params.type==='window'&&e.params.origin===origin).map(e=>e.params.realm));
  const owned=events.filter(e=>e.method==='script.realmCreated'&&e.params.type==='dedicated-worker'&&scripts.includes(e.params.origin.slice(origin.length))&&e.params.origin.startsWith(origin+'/')&&e.params.owners?.length===1&&windows.has(e.params.owners[0]));
  const created=owned.map(e=>e.params.realm);
  const destroyed=events.filter(e=>e.method==='script.realmDestroyed'&&created.includes(e.params.realm)).map(e=>e.params.realm);
  return {created,destroyed,allWorkersDestroyed:scripts.length>0&&scripts.every(s=>owned.filter(e=>e.params.origin===origin+s).length===1)&&created.every(r=>destroyed.includes(r))};
}
