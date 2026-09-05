// THROWAWAY: three combat HUDs over the existing scene, selected with ?variant=A|B|C.
// Combat, contacts, chart, and navigation values below are illustrative, not simulation telemetry.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './hud-prototype.css';

export const isHudPrototype = import.meta.env.DEV && new URLSearchParams(location.search).has('variant');
type Variant = 'A' | 'B' | 'C';
type GlyphName = 'shell' | 'he' | 'repair' | 'hydro' | 'plane' | 'fire' | 'eye' | 'turret' | 'ship' | 'arrow' | 'target';
const VARIANTS: Variant[] = ['A', 'B', 'C'];
const NAMES = { A: 'Fleet action', B: 'Gunnery station', C: 'Open sea' };
const DESCRIPTIONS = {
  A: 'Familiar combat layout. Ship at left, weapons below, tactical map at right.',
  B: 'Gunnery comes first. Range, individual turrets, and compartment damage stay visible.',
  C: 'More ocean, fewer instruments. Combat essentials stay close to your line of sight.',
};
const initialVariant = (): Variant => {
  const value = new URLSearchParams(location.search).get('variant');
  return VARIANTS.includes(value as Variant) ? value as Variant : 'A';
};

function Glyph({ name, size = 24 }: { name: GlyphName; size?: number }) {
  const paths: Record<GlyphName, ReactNode> = {
    shell: <><path d="M9 20V9c0-3 3-6 3-6s3 3 3 6v11ZM9 15h6M9 18h6"/><path d="M7 21h10"/></>,
    he: <><path d="M8 20V10l4-7 4 7v10ZM8 15h8M8 18h8M8 10h8"/></>,
    repair: <><path d="m5 20 8-8a6 6 0 0 0 7-7l-4 4-3-3 4-4a6 6 0 0 0-7 7l-8 8Z"/></>,
    hydro: <><path d="M4 12h3m3 0h2m0 0 6-7m-6 7 6 7"/><path d="M14 3a11 11 0 0 1 0 18M12 7a6 6 0 0 1 0 10"/></>,
    plane: <path d="m12 2 2 9 7 4v2l-7-2v5l2 2h-8l2-2v-5l-7 2v-2l7-4Z"/>,
    fire: <path d="M13 2c1 6-5 6-2 11 2-1 3-4 3-4s5 4 5 7a7 7 0 0 1-14 0c0-5 7-8 8-14Z"/>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    turret: <><path d="M5 20V12l3-3h8l3 3v8ZM9 9V2m6 7V2M3 21h18"/><path d="M8 16h8"/></>,
    ship: <><path d="m2 16 3 5h13l4-5H2ZM6 16v-4h11v4M10 12V8h4v4M12 8V3m0 2h5"/></>,
    arrow: <path d="m9 5 7 7-7 7"/>,
    target: <><path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6"/><circle cx="12" cy="12" r="3"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function ShipPlan({ damaged = false }: { damaged?: boolean }) {
  return <svg className="hp-ship-plan" viewBox="0 0 90 230" fill="none" aria-label="Ship compartments and four main turrets" role="img">
    <path d="M45 5C33 20 21 44 20 76v115l10 26h30l10-26V76C69 44 57 20 45 5Z" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="1.2"/>
    <path d="M27 74h36M23 151h44M27 194h36M45 7v26" stroke="currentColor" opacity=".45"/>
    <rect x="31" y="84" width="28" height="64" rx="7" fill="currentColor" fillOpacity=".18" stroke="currentColor"/>
    <path d="M35 100h20v15H35Zm0 23h20v15H35Z" stroke="currentColor"/>
    {[47, 70, 166, 190].map((y, i) => <g key={y} className={damaged && i === 2 ? 'hp-warn' : ''}>
      <path d={`M37 ${y-8}h16l3 8-3 8H37l-3-8Z`} fill="currentColor" fillOpacity=".4" stroke="currentColor"/>
      <path d={`M41 ${y-8}v-17m8 17v-17`} stroke="currentColor" strokeWidth="2"/>
    </g>)}
    {damaged && <rect x="30" y="122" width="30" height="27" className="hp-warn" fill="currentColor" fillOpacity=".45" stroke="currentColor"/>}
  </svg>;
}

function Match({ compact = false }: { compact?: boolean }) {
  return <div className={`hp-match ${compact ? 'hp-match-compact' : ''}`} aria-label="Sample match: allies 420, enemies 365, 12 minutes 48 seconds remaining">
    {!compact && <div className="hp-fleet"><span>{Array.from({ length: 9 }, (_, i) => <Glyph name="ship" size={15} key={i}/>)}</span><small>12:48</small><span>{Array.from({ length: 9 }, (_, i) => <Glyph name="ship" size={15} key={i}/>)}</span></div>}
    <div className="hp-score"><strong className="hp-ally">420</strong><i/><div className="hp-objectives"><b className="hp-captured">A</b><b>B</b><b className="hp-hostile">C</b></div><i/><strong className="hp-enemy">365</strong></div>
    {compact && <small>DOMINATION <span>12:48</span></small>}
  </div>;
}

function TacticalMap({ round = false }: { round?: boolean }) {
  return <aside className={`hp-map ${round ? 'hp-map-round' : ''}`} aria-label="Illustrative tactical map with allies, enemies, capture zones and firing range">
    <div className="hp-map-top"><span>NORTH ATLANTIC</span><span>N ↑</span></div>
    <svg viewBox="0 0 250 250" role="img" aria-label="Tactical chart">
      <defs><pattern id="hp-grid" width="31.25" height="31.25" patternUnits="userSpaceOnUse"><path d="M31.25 0H0V31.25" fill="none" stroke="currentColor" strokeOpacity=".14" strokeWidth=".75"/></pattern></defs>
      <rect width="250" height="250" fill="url(#hp-grid)"/>
      <g fill="currentColor" fillOpacity=".13" stroke="currentColor" strokeOpacity=".25" strokeWidth=".6"><path d="m14 63 17-19 19-8 10 9-8 12-4 23-17 12-20-5-7-12Z"/><path d="m194 39 13-12 18 5 16 24-7 26-16 5-11-18-16-9Z"/><path d="m109 132 12-15 13 4 4 17-14 19-16-8Z"/><path d="m178 186 18-13 24 12 11 22-8 22-21-2-11-17-15-8Z"/></g>
      <g fill="none" stroke="currentColor" strokeOpacity=".3"><circle cx="111" cy="180" r="100" strokeDasharray="4 4"/><path d="M111 180 59 4M111 180 199 21"/><path d="M111 180 139 235" strokeDasharray="3 4"/></g>
      <path d="M111 180 68 56Q113 41 153 64Z" fill="currentColor" fillOpacity=".06"/>
      {[[67,100,'A','hp-ally'],[139,78,'B',''],[193,123,'C','hp-enemy']].map(([x,y,label,c]) => <g key={label} className={String(c)}><circle cx={x} cy={y} r="18" fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeOpacity=".65"/><text x={x} y={Number(y)+4} textAnchor="middle" fill="currentColor" fontSize="12">{label}</text></g>)}
      {[[71,168,-15],[44,145,20],[149,203,15],[79,211,-30],[168,161,35]].map(([x,y,r], i) => <path key={i} d="m0-7-4 12 4-2 4 2Z" transform={`translate(${x} ${y}) rotate(${r})`} className="hp-ally" fill="currentColor"/>)}
      {[[126,60,60],[181,84,80],[208,108,25],[93,45,-60]].map(([x,y,r], i) => <g key={i} transform={`translate(${x} ${y}) rotate(${r})`} className="hp-enemy"><path d="M0-6 4 0 0 6-4 0Z" fill="currentColor"/>{i === 0 && <path d="M-8-9H8V9H-8Z" stroke="currentColor" fill="none"/>}</g>)}
      <path d="m111 170-6 17 6-4 6 4Z" fill="#fff4d4" stroke="#fff4d4"/>
      {!round && <g fill="currentColor" opacity=".65" fontSize="7">{Array.from({length:8},(_,i)=><g key={i}><text x={i*31.25+14} y="9">{i+1}</text><text x="4" y={i*31.25+19}>{String.fromCharCode(65+i)}</text></g>)}</g>}
    </svg>
    <div className="hp-map-bottom"><span>F6</span><span>5 km <i/></span><span>+ / −</span></div>
  </aside>;
}

function Contact({ sparse = false }: { sparse?: boolean }) {
  return <div className={`hp-contact ${sparse ? 'hp-contact-sparse' : ''}`}>
    <div className="hp-contact-class"><Glyph name="ship" size={17}/><span>VIII</span></div>
    <strong>HMS HOOD</strong><div className="hp-contact-health"><i/></div><span>12.4 km</span><div className="hp-contact-point"/>
  </div>;
}

function Sight({ technical = false, sparse = false, reload }: { technical?: boolean; sparse?: boolean; reload: number }) {
  return <div className={`hp-sight ${technical ? 'hp-sight-technical' : ''} ${sparse ? 'hp-sight-sparse' : ''}`}>
    <svg viewBox="0 0 540 90" fill="none" aria-label="Gunnery sight">
      <path d="M10 45h235m50 0h235M270 22v13m0 20v13" stroke="currentColor" strokeOpacity=".9"/>
      {!sparse && Array.from({length:21},(_,i)=> i===10 ? null : <g key={i}><path d={`M${20+i*25} 45v${i%2===0?10:5}`} stroke="currentColor" strokeOpacity=".8"/>{i%2===0 && <text x={20+i*25} y="72" fill="currentColor" textAnchor="middle" fontSize="10">{Math.abs(i-10)}</text>}</g>)}
      <circle cx="270" cy="45" r={sparse?4:7} stroke="currentColor"/><path d="M267 45h6m-3-3v6" stroke="currentColor"/>
      {technical && <><path d="M225 15h-20v60h20m90-60h20v60h-20" stroke="currentColor" strokeOpacity=".6"/><text x="82" y="22" fill="currentColor" fontSize="10">LEAD  4.2</text><text x="400" y="22" fill="currentColor" fontSize="10">+ 100 m</text></>}
    </svg>
    <div className="hp-sight-values"><span>{technical ? 'FLIGHT' : ''} 7.8 s</span><strong>12.40 <small>km</small></strong><span>{reload ? `${reload.toFixed(1)} s` : 'READY'}</span></div>
  </div>;
}

function Detection({ damaged }: { damaged: boolean }) {
  return <div className={`hp-detection ${damaged ? 'hp-danger' : ''}`}><Glyph name={damaged?'fire':'eye'} size={22}/><strong>{damaged?'FIRE ON DECK':'DETECTED'}</strong><span>{damaged?'1 active fire':'By sea'}</span></div>;
}

function Health({ damaged, minimal = false }: { damaged: boolean; minimal?: boolean }) {
  return <div className={`hp-health ${minimal ? 'hp-health-minimal' : ''}`}>
    <div className="hp-ship-name"><Glyph name="ship" size={24}/><strong>BISMARCK</strong><span>VIII</span></div>
    <div className="hp-hp-value"><strong>{damaged?'38,640':'58,200'}</strong><span>/ 69,200</span>{minimal && <small>HP</small>}</div>
    <div className="hp-health-bar"><i style={{width:damaged?'56%':'84%'}}/><b style={{left:damaged?'56%':'84%',width:damaged?'15%':'7%'}}/></div>
  </div>;
}

function Engine({ simple = false }: { simple?: boolean }) {
  return <div className={`hp-engine ${simple ? 'hp-engine-simple' : ''}`}>
    <div className="hp-speed"><strong>26.8</strong><span>kn</span><b>FULL</b></div>
    {!simple && <div className="hp-throttle">{['REV','STOP','¼','½','¾','FULL'].map(label=><span className={label==='FULL'?'hp-active':''} key={label}>{label}</span>)}</div>}
    <div className="hp-steering"><span>A</span><div><i/></div><strong>0°</strong><div/><span>D</span></div>
  </div>;
}

type CombatProps = { damaged: boolean; ammo: 'AP'|'HE'; setAmmo: (a:'AP'|'HE')=>void; reload: number; fire: ()=>void; repair: ()=>void };
function Armament({ ammo, setAmmo, reload, fire, repair, damaged, compact = false }: CombatProps & { compact?: boolean }) {
  const items: { key: string; label: string; name: GlyphName; meta: string; action: ()=>void; active?: boolean }[] = [
    { key:'1',label:'HE',name:'he',meta:'380 mm',action:()=>setAmmo('HE'),active:ammo==='HE' },
    { key:'2',label:'AP',name:'shell',meta:'380 mm',action:()=>setAmmo('AP'),active:ammo==='AP' },
    { key:'R',label:'DAMAGE CONTROL',name:'repair',meta:damaged?'EXTINGUISH':'READY',action:repair },
    { key:'T',label:'REPAIR PARTY',name:'ship',meta:'3',action:repair },
  ];
  return <div className={`hp-armament ${compact?'hp-armament-compact':''}`}>
    <div className="hp-battery-caption"><span>MAIN BATTERY <b>380 mm</b></span><strong>{reload?`RELOADING ${reload.toFixed(1)} s`:'ALL GUNS READY'}</strong></div>
    <div className="hp-turret-readiness">{['A','B','C','D'].map((name,i)=><span key={name} className={damaged && i===2?'hp-warn':''}><Glyph name="turret" size={18}/><b>{name}</b><i style={{opacity:reload?.4:1}}/></span>)}</div>
    <div className="hp-weapon-row">{items.map(item=><button key={item.key} className={`hp-weapon ${item.active?'hp-selected':''}`} onClick={item.action} aria-pressed={item.active} title={`${item.label} — ${item.key}`} aria-label={item.label==='HE'?'Select high explosive':item.label==='AP'?'Select armor piercing':item.label}>
      <kbd>{item.key}</kbd><Glyph name={item.name} size={32}/><strong>{item.label}</strong><small>{item.meta}</small>
    </button>)}<button className="hp-fire-salvo" onClick={fire} disabled={reload>0}><Glyph name="target" size={22}/><strong>{reload?`${reload.toFixed(1)} s`:'FIRE SALVO'}</strong><kbd>↵</kbd></button></div>
  </div>;
}

export function VariantA(props: CombatProps) {
  return <div className="hp-world hp-world-a">
    <div className="hp-mission"><strong>NORTH ATLANTIC</strong><span>Domination · Capture and defend the key areas</span></div>
    <Match/><div className="hp-battle-damage"><span>DAMAGE CAUSED</span><strong>24,860</strong><small>8 hits · 2 penetrations</small></div>
    <Contact/><div className="hp-distant-contact hp-ally"><Glyph name="ship" size={15}/> PRINZ EUGEN <span>5.8 km</span></div>
    <Sight reload={props.reload}/><Detection damaged={props.damaged}/>
    <section className="hp-own-ship"><Health damaged={props.damaged}/><div className="hp-navigation"><div className="hp-bearing"><span>000°</span><ShipPlan damaged={props.damaged}/><b>N</b><i/></div><Engine/></div><div className="hp-condition"><span className={props.damaged?'hp-warn':''}><Glyph name="fire" size={14}/>{props.damaged?'FIRE × 1':'NO FIRE'}</span><span>FLOODING 0</span><span>AA AUTO</span></div></section>
    <Armament {...props}/><TacticalMap/>
    <div className="hp-match-feed"><span className="hp-ally">Prinz Eugen</span> captured area <b>A</b></div>
  </div>;
}

export function VariantB(props: CombatProps) {
  return <div className="hp-world hp-world-b">
    <div className="hp-mission"><strong>NORTH ATLANTIC</strong><span>Domination · Capture and defend the key areas</span></div><Match/>
    <div className="hp-course"><span>330</span><span>345</span><b>N</b><span>015</span><span>030</span><i/></div>
    <Contact/><Sight technical reload={props.reload}/><Detection damaged={props.damaged}/>
    <aside className="hp-firing-solution"><div><Glyph name="target" size={17}/><strong>FIRING SOLUTION</strong></div><p>HMS HOOD <span>Battlecruiser</span></p><dl><div><dt>Range</dt><dd>12,400 <small>m</small></dd></div><div><dt>Range rate</dt><dd>−18 <small>m/s</small></dd></div><div><dt>Flight time</dt><dd>7.8 <small>s</small></dd></div><div><dt>Target course</dt><dd>248<small>°</small></dd></div></dl><footer>TRACKING <span>Optical rangefinder</span></footer></aside>
    <section className="hp-damage-station"><Health damaged={props.damaged}/><div className="hp-compartments"><ShipPlan damaged={props.damaged}/><div><strong>{props.damaged?'72%':'94%'} <small>CREW</small></strong><dl><div><dt>Bridge</dt><dd>Operational</dd></div><div><dt>Engines</dt><dd className={props.damaged?'hp-warn':''}>{props.damaged?'On fire':'Operational'}</dd></div><div><dt>Rudder</dt><dd>Operational</dd></div><div><dt>Magazines</dt><dd>Intact</dd></div></dl></div></div><Engine/></section>
    <section className="hp-gun-station"><div className="hp-gun-station-title"><strong>MAIN BATTERY</strong><span>4 × 2 · 380 mm</span><span>{props.ammo} LOADED</span></div><div className="hp-gun-modules">{['ANTON','BRUNO','CAESAR','DORA'].map((name,i)=><div key={name}><Glyph name="turret" size={28}/><strong>{name}</strong><span className={props.damaged&&i===2?'hp-warn':''}>{props.damaged&&i===2?'TRAVERSING':props.reload?`${props.reload.toFixed(1)} s`:'READY'}</span><i style={{width:`${props.reload?(1-props.reload/12)*100:100}%`}}/></div>)}</div><Armament {...props}/></section>
    <TacticalMap/><div className="hp-gunnery-footer"><span>RANGE CORRECTION <b>+100 m</b></span><span>DISPERSION <b>186 m</b></span><span>BEARING <b>004°</b></span></div>
  </div>;
}

export function VariantC(props: CombatProps) {
  return <div className="hp-world hp-world-c">
    <Match compact/><div className="hp-cinematic-objective"><b>B</b><div><strong>CONTEST THE SECTOR</strong><span>North Atlantic · 3.2 km</span></div></div>
    <div className="hp-cinematic-damage"><strong>24,860</strong><span>damage caused</span></div>
    <Contact sparse/><Sight sparse reload={props.reload}/><Detection damaged={props.damaged}/>
    <div className="hp-context-guns"><span>{props.ammo} · 380 mm</span><div>{[0,1,2,3].map(i=><i key={i} className={props.damaged&&i===2?'hp-warn':''}/>)}</div><strong>{props.reload?`Reloading · ${props.reload.toFixed(1)} s`:'4 turrets ready'}</strong></div>
    <section className="hp-cinematic-helm"><Health damaged={props.damaged} minimal/><Engine simple/></section>
    <Armament {...props} compact/><TacticalMap round/>
    <div className="hp-cinematic-course"><span>345</span><span>│</span><strong>N <b>000°</b></strong><span>│</span><span>015</span></div>
  </div>;
}

export function HudPrototype() {
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [damaged, setDamaged] = useState(false);
  const [ammo, setAmmo] = useState<'AP'|'HE'>('AP');
  const [reload, setReload] = useState(0);
  const [scale, setScale] = useState(1);
  const [hideReview, setHideReview] = useState(new URLSearchParams(location.search).has('clean'));
  const root = useRef<HTMLDivElement>(null);
  const fire = () => setReload(value => value>0?value:12);
  const repair = () => setDamaged(false);
  const choose = (next: Variant) => {
    setVariant(next);
    const url = new URL(location.href); url.searchParams.set('variant', next); history.replaceState({}, '', url);
  };
  const cycle = (delta: number) => choose(VARIANTS[(VARIANTS.indexOf(variant)+delta+3)%3]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(entry.contentRect.width/1600, entry.contentRect.height/900, 1.25)));
    observer.observe(root.current!); return ()=>observer.disconnect();
  }, []);
  useEffect(() => {
    if (!reload) return;
    const timer = window.setInterval(() => setReload(value=>Math.max(0,Math.round((value-.1)*10)/10)),100);
    return ()=>clearInterval(timer);
  }, [reload>0]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
      if (event.code==='Enter' && (event.target as HTMLElement).closest('button, a')) return;
      if (event.code==='ArrowLeft'||event.code==='ArrowRight') { event.preventDefault();event.stopImmediatePropagation();cycle(event.code==='ArrowLeft'?-1:1); }
      if (['Digit1','Digit2','Enter','KeyR','KeyT','Backquote'].includes(event.code)) {
        event.preventDefault();event.stopImmediatePropagation();
        if (event.code==='Digit1') setAmmo('HE'); if(event.code==='Digit2') setAmmo('AP');
        if(event.code==='Enter') fire();if(event.code==='KeyR'||event.code==='KeyT')repair();
        if(event.code==='Backquote')setHideReview(value=>!value);
      }
    };
    window.addEventListener('keydown',key,true);
    const pop = ()=>setVariant(initialVariant()); window.addEventListener('popstate',pop);
    return ()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('popstate',pop);};
  }, [variant]);
  const props: CombatProps = { damaged, ammo, setAmmo, reload, fire, repair };
  return <div className={`hp-prototype ${hideReview?'hp-clean':''}`} ref={root} data-variant={variant}>
    <div className="hp-edge-shade"/>
    <div className="hp-stage" style={{'--hp-scale':scale} as CSSProperties}>
      {variant==='A'?<VariantA {...props}/>:variant==='B'?<VariantB {...props}/>:<VariantC {...props}/>}
    </div>
    {!hideReview && <>
      <div className="hp-review-state"><span>HUD MOCKUP · SAMPLE COMBAT DATA</span><button aria-pressed={damaged} onClick={()=>setDamaged(value=>!value)}>{damaged?'Under fire':'Cruising'}<i/></button><button title="Hide review controls · `" aria-label="Hide review controls" onClick={()=>setHideReview(true)}>×</button></div>
      <div className="hp-review-copy" aria-live="polite"><strong>{variant} — {NAMES[variant]}</strong><span>{DESCRIPTIONS[variant]}</span></div>
      <nav className="hp-switcher" aria-label="HUD mockup variants"><button aria-label="Previous HUD" onClick={()=>cycle(-1)}><span className="hp-prev"><Glyph name="arrow" size={17}/></span></button><div>{VARIANTS.map(value=><button key={value} aria-pressed={variant===value} onClick={()=>choose(value)}><b>{value}</b>{NAMES[value]}</button>)}</div><button aria-label="Next HUD" onClick={()=>cycle(1)}><Glyph name="arrow" size={17}/></button></nav>
      <a className="hp-back" href="/">Return to sea trials</a>
    </>}
    {hideReview && <button className="hp-show-review" onClick={()=>setHideReview(false)}>Show mockup controls</button>}
  </div>;
}
