/* ABSOLUTE ULTIMATE ONE‑FILE EMBED AD‑BLOCKER */
/* Drop this at end of <body> or include with defer */

/* IIFE to contain everything */
(function(){

  const enabled = true;
  if (!enabled) return;

  // Only target embed domains
  const embedDomains = ['vidsrc.xyz','vidplay.to'];
  if (!embedDomains.some(d=>location.hostname.includes(d))) return;

  // ————— CORE REDIRECT & POPUP BLOCKS —————

  window.open = ()=>{console.warn('Blocked window.open'); return null;};
  const noop = ()=>{console.warn('Blocked navigation/redirect');};
  ['location','href'].forEach(p=>{
    [window,document,top,window.parent].forEach(obj=>{
      try{ Object.defineProperty(obj,p,{
        configurable:false, enumerable:true,
        get:()=>obj.__proto__[p], set:noop
      }); } catch{}
    });
  });
  if(window.location) { window.location.assign=noop; window.location.replace=noop; }
  if(top.location)    { top.location.assign=noop;    top.location.replace=noop; }
  history.pushState = history.replaceState = ()=>console.warn('Blocked history API');
  window.navigate = noop;
  window.onbeforeunload = window.onunload = null;
  window.addEventListener('beforeunload', e=>e.stopImmediatePropagation(), true);
  window.addEventListener('unload',       e=>e.stopImmediatePropagation(), true);

  // ————— BASIC AD HIDER —————

  const adSelectors = [
    '[id*="ad"]','[class*="ad"]','[class*="ads"]','[class*="banner"]',
    '.ad-overlay','.ad-popup','.ad-banner','.adsbygoogle','.adsense',
    '.ad-container','.advertisement','.sponsor','.promo','.skip-ad',
    '.countdown','.overlay-block','.video-ads'
  ];
  function hideAds(root=document.body){
    adSelectors.forEach(sel=>
      root.querySelectorAll(sel).forEach(el=>{
        el.remove?.() ||
        ['display','visibility','opacity','pointer-events','position','top','left','width','height','z-index']
        .forEach(k=>el.style.setProperty(k,'none','important'));
      })
    );
  }
  hideAds();
  new MutationObserver(ms=>ms.forEach(m=>
    m.addedNodes.forEach(n=>n.nodeType===1&&hideAds(n))
  )).observe(document.body, {childList:true, subtree:true});

  // ————— CLICK & INTERACTION GUARDS —————

  document.addEventListener('click', e=>{
    let el = e.target;
    while(el && el!==document.body){
      if(el.matches?.('a[href^="http"],button,input[type="button"],input[type="submit"]') &&
         /ad|promo|sponsor|banner/i.test(el.className+el.id)){
        e.preventDefault(); e.stopImmediatePropagation();
        console.warn('Blocked ad click');
        return false;
      }
      el = el.parentElement;
    }
  }, true);

  // iframe shield + decoy click
  function shieldIframes(){
    document.querySelectorAll('iframe').forEach(iframe=>{
      if(iframe.dataset.shielded) return;
      const sh = document.createElement('div');
      sh.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:pointer;background:transparent;z-index:9999';
      iframe.parentElement?.style.setProperty('position','relative','important');
      iframe.parentElement?.appendChild(sh);
      sh.addEventListener('click', e=>{
        // decoy click behind the scenes
        const d = document.createElement('div');
        d.style.cssText = `position:absolute;width:1px;height:1px;top:${e.clientY}px;left:${e.clientX}px`;
        document.body.appendChild(d);
        ['mousedown','mouseup','click'].forEach(evt=> d.dispatchEvent(new MouseEvent(evt,{bubbles:true})));
        d.remove();
        hideAds(); sh.remove();
        console.log('Iframe unlocked');
      });
      iframe.dataset.shielded = '1';
    });
  }
  setInterval(shieldIframes, 3000);

  // remove ad delays
  setInterval(()=>['.ad-delay-overlay','.ad-countdown','.countdown-timer','.skip-ad']
    .forEach(s=>document.querySelectorAll(s).forEach(el=>el.style.display='none')), 2000);

  // nuker by geometry/z-index
  setInterval(()=>{
    document.querySelectorAll('div,a,span').forEach(el=>{
      const r = el.getBoundingClientRect(),
            z = parseInt(getComputedStyle(el).zIndex)||0,
            op = parseFloat(getComputedStyle(el).opacity)||1,
            pe = getComputedStyle(el).pointerEvents;
      if(z>1000 && r.width>100 && r.height>50 && pe!=='none' && op>0.1){
        console.warn('Nuked overlay',el); el.remove();
      }
    });
  }, 1000);

  // ————— SCRIPT & DOM HOOKS —————

  // intercept script creation + inline JS scrub
  (()=>{
    const realCE = Document.prototype.createElement;
    Document.prototype.createElement = function(tag, opts){
      const el = realCE.call(this, tag, opts);
      if(tag.toLowerCase()==='script'){
        Object.defineProperty(el,'src',{ set(u){
          if(/ads?|track|pop/i.test(u)){ console.warn('Blocked script src',u); return; }
          HTMLScriptElement.prototype.__lookupSetter__('src').call(this, u);
        }, get(){
          return HTMLScriptElement.prototype.__lookupGetter__('src').call(this);
        }, configurable:true });
        const desc = Object.getOwnPropertyDescriptor(Element.prototype,'textContent');
        Object.defineProperty(el,'textContent',{ set(c){
          if(/location\.href|window\.open|eval|Function\(/i.test(c)){
            console.warn('Blocked inline JS'); return;
          }
          desc.set.call(this,c);
        }, get(){
          return desc.get.call(this);
        }, configurable:true});
      }
      return el;
    };
  })();

  // override DOM insertion
  (()=>{
    [Element.prototype, Document.prototype].forEach(proto=>
      ['appendChild','insertBefore','replaceChild'].forEach(fn=>{
        const real = proto[fn];
        proto[fn] = function(node, ...a){
          if(node.tagName==='SCRIPT' || node.matches?.('[id*="ad"],[class*="ad"]')){
            console.warn(`Blocked ${fn}`,node); return node;
          }
          return real.call(this, node, ...a);
        };
      })
    );
  })();

  // override MutationObserver constructor
  (()=>{
    const RealMO = window.MutationObserver;
    window.MutationObserver = function(cb){
      const wrapped = (ms, obs)=>{
        ms.forEach(m=> m.addedNodes.forEach(n=> n.nodeType===1 && hideAds(n)));
        cb(ms, obs);
      };
      return new RealMO(wrapped);
    };
  })();

  // ————— NETWORK & FETCH GUARDS —————

  (()=>{
    const realFetch = window.fetch;
    window.fetch = function(input, init){
      const url = input.url || input;
      if(/ads?|track|pop/i.test(url)){ console.warn('Blocked fetch',url); return Promise.reject(); }
      return realFetch.call(this, input, init);
    };
    const realX = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, u){
      if(/ads?|track|pop/i.test(u)){ console.warn('Blocked XHR',u); return; }
      return realX.apply(this, arguments);
    };
    const realWS = window.WebSocket;
    window.WebSocket = function(u, p){
      if(/ads?|track|pop/i.test(u)){ console.warn('Blocked WS',u); return {}; }
      return new realWS(u, p);
    };
  })();

  // ————— EXECUTION & EVENT GUARDS —————

  // block eval / Function
  (()=>{
    window.eval = code => console.warn('Blocked eval');
    window.Function = (...args) => { console.warn('Blocked Function'); return ()=>{}; };
  })();
  // veto addEventListener
  (()=>{
    const realAE = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, fn, opts){
      if(/location\.href|window\.open|eval|Function\(/i.test(fn.toString())){
        console.warn('Blocked listener'); return;
      }
      return realAE.call(this, type, fn, opts);
    };
  })();
  // timeout vetos
  const realTO = window.setTimeout;
  window.setTimeout = (fn, d, ...a)=>{
    if(/location\.(href|assign|replace)|window\.open/i.test(fn.toString())){
      console.warn('Blocked setTimeout redirect'); return null;
    }
    return realTO(fn, d, ...a);
  };
  // clear inline handlers
  setInterval(()=>{
    document.querySelectorAll('*').forEach(el=>{
      try{ el.onclick=el.onmousedown=el.onmouseup=el.onpointerup=null; }catch{}
    });
  }, 3000);

  // ————— CSSOM & STYLESHEET GUARDS —————

  // block insertRule
  (()=>{
    const realIR = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function(rule, idx){
      if(/ads?|banner|sponsor|promo/i.test(rule)){ console.warn('Blocked CSS rule',rule); return; }
      return realIR.call(this, rule, idx);
    };
    const RealCSS = window.CSSStyleSheet;
    window.CSSStyleSheet = function(){ return new RealCSS(); };
  })();

  // ————— IFRAME / FORM / MESSAGE GUARDS —————

  // iframe.src setter
  (()=>{
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src');
    Object.defineProperty(HTMLIFrameElement.prototype,'src',{
      set(u){
        if(/eshkol|go\?|click|trk|ads?/.test(u)){ console.warn('Blocked iframe src',u); return; }
        desc.set.call(this, u);
      },
      get(){ return desc.get.call(this); },
      configurable:true
    });
  })();
  // form.submit guard
  (()=>{
    const real = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function(){
      const a = this.getAttribute('action')||'';
      if(/eshkol|go\?|click|track|pop/i.test(a)){ console.warn('Blocked form submit',a); return; }
      return real.call(this);
    };
  })();
  // postMessage scrub
  ((()=>{
    const realPM = Window.prototype.postMessage;
    Window.prototype.postMessage = function(msg, tgt){
      const m = typeof msg==='string'?msg:JSON.stringify(msg);
      if(/location\.href|go\?uid|eshkol|redirect/i.test(m)){ console.warn('Blocked postMessage'); return; }
      return realPM.call(this, msg, tgt);
    };
  })());
  // import() hook (ES modules)
  ((()=>{
    const realImport = window.import;
    window.import = path=>{
      if(/ads?|track|pop/i.test(path)){ console.warn('Blocked dynamic import',path); return Promise.reject(); }
      return realImport(path);
    };
  })());

  // ————— GLOBAL PROXY FOR ZERO‑DAY —————

  (()=>{
    function makeProxy(obj, name){
      return new Proxy(obj, {
        get(t, p){ 
          const ps = p.toString();
          if(/ad|ban|promo|redirect|track/i.test(ps)){
            console.warn(`Proxy blocked ${name}.${ps}`); return undefined;
          }
          return Reflect.get(t,p);
        },
        set(t, p, v){
          if(/ad|ban|promo|track|redirect/i.test(p.toString())){
            console.warn(`Proxy blocked set ${name}.${p}`); return true;
          }
          return Reflect.set(t,p,v);
        }
      });
    }
    window = makeProxy(window, 'window');
    document = makeProxy(document, 'document');
  })();

  // ————— CANVAS OVERLAY DETECTION —————

  (()=>{
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    const target = document.body;
    function detectOverlay(){
      const r = target.getBoundingClientRect();
      canvas.width = r.width; canvas.height = r.height;
      ctx.drawImage(target, 0, 0);
      const data = ctx.getImageData(0,0,100,10).data;
      let sum = 0;
      for(let i=0; i<data.length; i+=4){
        sum += Math.abs(data[i]-data[i+1]) + Math.abs(data[i]-data[i+2]);
      }
      if(sum < 1000){
        console.warn('Canvas detect overlay – nuking');
        hideAds();
      }
    }
    setInterval(detectOverlay, 1500);
  })();

  // ————— TIMER STORM EXHAUSTION —————

  (()=>{
    for(let i=0;i<200;i++){
      setTimeout(()=>{},1);
    }
  })();

  // ————— DYNAMIC SCRIPT FINGERPRINTING —————

  ((()=>{
    const seen = new Set();
    new MutationObserver(mo=>{
      mo.forEach(m=>{
        m.addedNodes.forEach(n=>{
          if(n.tagName==='SCRIPT'){
            const code = n.textContent || n.src || '';
            const hash = code.length + '-' + ((code.match(/\w/g)||[]).length);
            if(seen.has(hash)){
              console.warn('Removed duplicate script fingerprint');
              n.remove();
            } else seen.add(hash);
          }
        });
      });
    }).observe(document.documentElement, {childList:true, subtree:true});
  })());

  // ————— WEBGL DRAW CALL INTERCEPT —————

  ((()=>{
    const realGet = WebGLRenderingContext.prototype.getExtension;
    WebGLRenderingContext.prototype.getExtension = function(name){
      const ctx = realGet.call(this, name);
      if(name==='WEBGL_lose_context') return null;
      return ctx;
    };
    const realDraw = WebGLRenderingContext.prototype.drawElements;
    WebGLRenderingContext.prototype.drawElements = function(...args){
      try{
        const mode = args[0];
        if(mode===4 && args[1]>6){
          console.warn('Blocked large WebGL drawElements');
          return;
        }
      }catch{}
      return realDraw.apply(this, args);
    };
  })());

  // ————— SELF‑HEALING WATCHDOG —————

  setInterval(()=>{
    // can re-inject this script if removed; left as comment placeholder
    // if(!window.__ULTIMATE_ADBLOCK) { /* re-add <script> tag logic */ }
  }, 5000);

  // ————— ANTI‑FINGERPRINT SPOOF —————

  try{
    Object.defineProperty(navigator,'webdriver',{get:()=>false,configurable:true});
    Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3],configurable:true});
    Object.defineProperty(navigator,'languages',{get:()=>['en-US','en'],configurable:true});
    Object.defineProperty(document,'referrer',{get:()=>'',configurable:true});
    ['RTCPeerConnection','mozRTCPeerConnection','webkitRTCPeerConnection']
      .forEach(p=>window[p]=undefined);
  }catch{}

  /* ————— STEALTH MODULE: HIDE YOUR TRACE ————— */
  (function(){
    const bait = document.createElement('div');
    bait.className = 'adsbox ad-banner sponsored ad-container';
    bait.style.cssText = 'width:1px;height:1px;position:absolute;top:-1000px;left:-1000px;';
    document.body.appendChild(bait);

    const realGetCS = window.getComputedStyle;
    window.getComputedStyle = function(el,pseudo){
      if(el===bait){
        return {
          display:'block', visibility:'visible', opacity:'1',
          getPropertyValue(prop){
            if(prop==='display') return 'block';
            if(prop==='visibility') return 'visible';
            if(prop==='opacity') return '1';
            return '';
          }
        };
      }
      return realGetCS.call(window, el, pseudo);
    };

    ['offsetParent','offsetHeight','offsetWidth','clientHeight','clientWidth']
      .forEach(prop=>Object.defineProperty(HTMLElement.prototype,prop,{
        get(){
          if(this===bait){
            return prop.includes('Height')||prop.includes('Width')?1:document.body;
          }
          return Element.prototype[prop];
        }, configurable:true
      }));

    const realQS = Document.prototype.querySelector;
    Document.prototype.querySelector = function(sel){
      if(sel.match(/\.adsbox|\.ad-container|\.ad-banner/)) return bait;
      return realQS.call(this, sel);
    };
    const realQSA = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function(sel){
      if(sel.match(/\.adsbox|\.ad-container|\.ad-banner/)) return [bait];
      return realQSA.call(this, sel);
    };
    const realGEC = Document.prototype.getElementsByClassName;
    Document.prototype.getElementsByClassName = function(names){
      if(names.match(/adsbox|ad-container|ad-banner/)) return [bait];
      return realGEC.call(this, names);
    };
    const realMatches = Element.prototype.matches;
    Element.prototype.matches = function(sel){
      if(this===bait && sel.match(/\.adsbox|\.ad-container|\.ad-banner/)) return true;
      return realMatches.call(this, sel);
    };

    const realEntries = Performance.prototype.getEntriesByType;
    Performance.prototype.getEntriesByType = function(type){
      if(type==='resource'){
        return realEntries.call(this,type)
          .filter(e=>!/ads?|track|pop/i.test(e.name));
      }
      return realEntries.call(this,type);
    };

    const realErr = console.error;
    console.error = function(...args){
      if(args[0]&&typeof args[0]==='string'&&args[0].includes('Failed to load resource')){
        return;
      }
      return realErr.apply(console,args);
    };

    const realSupports = CSS.supports;
    CSS.supports = function(prop, value){
      if(prop.includes('ad')||value.includes('ad')) return true;
      return realSupports.call(CSS, prop, value);
    };

    const realObserve = MutationObserver.prototype.observe;
    MutationObserver.prototype.observe = function(target, opts){
      if(target===document.body && opts.subtree && opts.childList){
        this.callback([{addedNodes:[bait]}], this);
      }
      return realObserve.call(this, target, opts);
    };

    try{
      Object.defineProperty(navigator,'userAgent',{get:()=>{
        return window.navigator.userAgent.replace(/Chrome\/[\d\.]+/,()=>{
          const v=100+Math.floor(Math.random()*30);
          return `Chrome/${v}.0.0.0`;
        });
      },configurable:true});
    }catch{}

    delete window.adBlockEnabled;
    delete window.canRunAds;

    console.log('Stealth module loaded — adblock detection masked.');
  })();

  /* ————— MAX‑MAX STEALTH EXTENSIONS ————— */
  (function(){
    // 1) Fuzz Performance & Timing
    const realNow = performance.now;
    performance.now = ()=> realNow.call(performance) + (Math.random()*10-5);
    const realDateNow = Date.now;
    Date.now = ()=> realDateNow.call(Date) + (Math.random()*20-10);

    // 2) Mask DevTools and toString
    Object.defineProperty(window,'devtoolsOpen',{get:()=>false,configurable:true});
    const realToStr = Function.prototype.toString;
    Function.prototype.toString = function(){
      if(['makeProxy','shieldIframes'].includes(this.name)){
        return `function ${this.name}() { [native code] }`;
      }
      return realToStr.call(this);
    };

    // 3) Visibility API spoof
    Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});
    Object.defineProperty(document,'visibilityState',{get:()=> 'visible',configurable:true});
    document.addEventListener = new Proxy(document.addEventListener,{
      apply(fn,ctx,args){
        if(args[0]==='visibilitychange') return;
        return fn.apply(ctx,args);
      }
    });

    // 4) IntersectionObserver intercept
    const RealIO = window.IntersectionObserver;
    window.IntersectionObserver = function(cb,opts){
      const wrap=(entries,obs)=>{
        entries.forEach(e=>e.isIntersecting=true);
        cb(entries,obs);
      };
      return new RealIO(wrap,opts);
    };

    // 5) Brave/Firefox mask
    if(navigator.brave) navigator.brave.isBrave=Promise.resolve(false);
    if(navigator.userAgent.includes('Firefox')){
      Object.defineProperty(navigator,'userAgent',{get:()=>{
        return navigator.userAgent.replace(/Firefox\/[\d\.]+/,'Firefox/999.0');
      },configurable:true});
    }

    // 6) Hide overwritten props
    const hideList=['open','fetch','XMLHttpRequest','MutationObserver','IntersectionObserver','devtoolsOpen','visibilityState'];
    const realOwn=Object.getOwnPropertyNames;
    Object.getOwnPropertyNames = function(obj){
      return realOwn.call(Object,obj).filter(n=>!hideList.includes(n));
    };

    // 7) Trap console methods
    ['profile','profileEnd','time','timeEnd','table'].forEach(m=>console[m]=()=>{});

    // 8) ServiceWorker guard
    if(navigator.serviceWorker){
      const realReg=navigator.serviceWorker.register;
      navigator.serviceWorker.register = function(url,opts){
        if(/adblocker/.test(url)){console.warn('Blocked SW',url);return Promise.reject();}
        return realReg.call(this,url,opts);
      };
    }

    // 9) WebGL vendor spoof
    try{
      const c=document.createElement('canvas'), gl=c.getContext('webgl');
      const realGP=gl.getParameter;
      gl.getParameter = function(p){
        if(p===gl.VENDOR)   return 'Intel Inc.';
        if(p===gl.RENDERER) return 'ANGLE (Intel, Vulkan)';
        return realGP.call(this,p);
      };
    }catch{}

    //10) Phantom resource entry
    const realPerf=performance.getEntriesByType;
    performance.getEntriesByType = function(type){
      const list=realPerf.call(performance,type);
      if(type==='resource'){
        list.push({name:'https://ads.google.com/ads.js',initiatorType:'script'});
      }
      return list;
    };

    console.log('🚀 Max‑Max Stealth enabled.');
  })();

})();
