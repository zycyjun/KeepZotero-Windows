/* Based on KeepZotero by Yu-Hsiang M. Tsai (BSD-3-Clause; see LICENSE).
 * Zotero 10 command bindings, explicit confirmation, and an in-process tray worker.
 */
KeepZotero = {
  windows: new Map(), quitting: false, trayReady: false, worker: null,
  trayInfo: null, trayError: null,
  pref(name) { return Zotero.Prefs.get('extensions.keepzotero.'+name,true); },
  log(text) { Zotero.debug('KeepZotero: '+text); },
  async init({rootURI,reason}) {
    this.rootURI=rootURI;
    this.backgroundStartup=reason===1 && this.isBackgroundLaunch();
    // Hide before tray initialization; do not let startup focus calls reopen it.
    if(this.backgroundStartup) this.addToAllWindows();
    this.registerRelaunchHandler();
    this.quitObserver={observe:(subject,topic,data)=>{
      if(topic==='quit-application-granted') {this.quitting=true; return;}
      if(this.quitting || data==='restart' || data==='os-shutdown' || data==='os-session-end') return;
      const cancel=subject?.QueryInterface(Components.interfaces.nsISupportsPRBool);
      if(cancel && !cancel.data && !this.confirmExit(Zotero.getMainWindow())) cancel.data=true;
    }};
    Services.obs.addObserver(this.quitObserver,'quit-application-requested');
    Services.obs.addObserver(this.quitObserver,'quit-application-granted');
    if(Zotero.isWin) {
      try {await this.startTray();} catch(e) {this.trayError=String(e); this.log(this.trayError);}
      // If the tray is unavailable, keep the application reachable.
      if(this.backgroundStartup && !this.trayReady) {this.backgroundStartup=false; this.restoreAll();}
    }
  },
  isBackgroundLaunch() {
    if(!Zotero.isWin) return false;
    const {ctypes:C}=ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
    const kernel=C.open('kernel32.dll');
    try {
      const command=kernel.declare('GetCommandLineW',C.winapi_abi,C.jschar.ptr)().readString();
      return /(?:^|\s)-keepzotero-background(?:\s|$)/i.test(command);
    } finally {kernel.close();}
  },
  hideStartupWindow(win) {
    const entry=this.windows.get(win); if(!entry || win.closed) return;
    const hwnd=this.nativeWindow(win);
    if(win.windowState!==win.STATE_MINIMIZED) entry.windowState=win.windowState;
    entry.fullScreen=win.fullScreen;
    this.native.show(hwnd,0); entry.hidden=true;
  },
  registerRelaunchHandler() {
    const Ci=Components.interfaces;
    this.relaunchClassID=Components.ID('{d8c2c87a-97d8-4b8c-b391-ec419c9d42ac}');
    this.relaunchContract='@keepzotero.local/command-line-handler;1';
    this.relaunchCategory='l-keepzotero-tray';
    this.relaunchHandler={
      QueryInterface:ChromeUtils.generateQI([Ci.nsICommandLineHandler]),
      helpInfo:'',
      handle:cmdLine=>{
        if(cmdLine.state===Ci.nsICommandLine.STATE_INITIAL_LAUNCH || this.quitting) return;
        // Word integration and silent launches must keep running in the background.
        if(cmdLine.findFlag('ZoteroIntegrationAgent',false)>=0 || cmdLine.findFlag('silent',false)>=0) return;
        if(!Array.from(this.windows.values()).some(entry=>entry.hidden)) return;
        this.relaunchCount=(this.relaunchCount||0)+1;
        this.log('Received application relaunch; showing the hidden main window');
        this.open();
      }
    };
    this.relaunchFactory={
      QueryInterface:ChromeUtils.generateQI([Ci.nsIFactory]),
      createInstance:iid=>this.relaunchHandler.QueryInterface(iid)
    };
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar).registerFactory(
      this.relaunchClassID,'KeepZotero application relaunch',this.relaunchContract,this.relaunchFactory);
    Services.catMan.addCategoryEntry('command-line-handler',this.relaunchCategory,this.relaunchContract,false,true);
  },
  unregisterRelaunchHandler() {
    if(!this.relaunchFactory) return;
    Services.catMan.deleteCategoryEntry('command-line-handler',this.relaunchCategory,false);
    Components.manager.QueryInterface(Components.interfaces.nsIComponentRegistrar).unregisterFactory(
      this.relaunchClassID,this.relaunchFactory);
    this.relaunchHandler=null; this.relaunchFactory=null;
  },
  async startTray() {
    const {NetUtil}=ChromeUtils.importESModule('resource://gre/modules/NetUtil.sys.mjs');
    const channel=NetUtil.newChannel({uri:this.rootURI+'native/keepzotero-tray.dll',loadUsingSystemPrincipal:true});
    const bytes=await new Promise((resolve,reject)=>NetUtil.asyncFetch(channel,(stream,status)=>{
      if(!Components.isSuccessCode(status)) {reject(new Error('Cannot read native tray bridge: '+status)); return;}
      try {
        const binary=Components.classes['@mozilla.org/binaryinputstream;1'].createInstance(Components.interfaces.nsIBinaryInputStream);
        binary.setInputStream(stream); resolve(new Uint8Array(binary.readByteArray(binary.available())));
      } catch(e) {reject(e);}
    }));
    const bridge=PathUtils.join(Services.dirsvc.get('ProfD',Components.interfaces.nsIFile).path,'keepzotero-tray-0.3.5.dll');
    if(!(await IOUtils.exists(bridge))) await IOUtils.write(bridge,bytes);
    const worker=new ChromeWorker('chrome://keepzotero-tray/content/tray-worker.js'); this.worker=worker;
    await new Promise(resolve=>{
      const timer=setTimeout(()=>{this.trayError='托盘启动超时，仍可最小化到任务栏'; resolve();},5000);
      worker.onmessage=event=>{
        const data=event.data;
        if(data.type==='ready') {
          this.trayInfo=data; this.trayReady=true; this.trayError=null; clearTimeout(timer); resolve();
        } else if(data.type==='error') {
          this.trayError=data.message; this.log('Tray error: '+data.message);
          this.trayReady=false; this.restoreAll(); clearTimeout(timer); resolve();
        } else if(data.type==='open') this.open();
        else if(data.type==='quit') this.requestQuit();
        else if(data.type==='stopped') this.stopResolve?.();
        else if(data.type==='menu-info') this.menuInfo=data.captions;
      };
      worker.onerror=event=>{
        this.trayError=event.message; this.log('Tray worker: '+event.message);
        this.trayReady=false; this.restoreAll(); clearTimeout(timer); resolve(); event.preventDefault();
      };
      const exe=Services.dirsvc.get('XREExeF',Components.interfaces.nsIFile).path;
      worker.postMessage({type:'start',exe,bridge});
    });
  },
  baseWindow(win) {
    return win.docShell.treeOwner.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
      .getInterface(Components.interfaces.nsIBaseWindow);
  },
  nativeWindow(win) {
    if(!this.native) {
      const {ctypes:C}=ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
      const user=C.open('user32.dll');
      this.native={C,user,
        show:user.declare('ShowWindow',C.winapi_abi,C.int32_t,C.voidptr_t,C.int32_t),
        visible:user.declare('IsWindowVisible',C.winapi_abi,C.int32_t,C.voidptr_t)};
    }
    return this.native.C.cast(this.native.C.uintptr_t(this.baseWindow(win).nativeHandle),this.native.C.voidptr_t);
  },
  isVisible(win) {const hwnd=this.nativeWindow(win); return !!this.native.visible(hwnd);},
  minimize(win) {
    if(Zotero.isWin && this.pref('cb_minimize_to_tray') && this.trayReady) {
      try {
        const hwnd=this.nativeWindow(win);
        const entry=this.windows.get(win);
        if(entry && !entry.hidden) {
          entry.windowState=win.windowState;
          entry.fullScreen=win.fullScreen;
        }
        this.native.show(hwnd,0);
        if(entry) entry.hidden=true;
        return;
      } catch(e) {this.log('Could not hide window: '+e);}
    }
    win.minimize();
  },
  restoreWindow(win) {
    if(!win || win.closed) return;
    const entry=this.windows.get(win);
    if(Zotero.isWin) {
      try {
        const hwnd=this.nativeWindow(win);
        // SW_SHOW retains the normal position; SW_SHOWMAXIMIZED retains maximization.
        // SW_RESTORE is needed only for an actually minimized window.
        const show=entry?.hidden
          ? (entry.windowState===win.STATE_MAXIMIZED ? 3 : 5)
          : (win.windowState===win.STATE_MINIMIZED ? 9 : 5);
        this.native.show(hwnd,show);
        if(entry?.hidden) win.fullScreen=entry.fullScreen;
      } catch(e) {this.log('Restore: '+e);}
    } else if(win.windowState===win.STATE_MINIMIZED) win.restore();
    if(entry) entry.hidden=false;
  },
  open() {
    this.backgroundStartup=false;
    const win=Zotero.getMainWindow();
    // A silent logon launch creates only the tray; create the main window on demand.
    if(!win || win.closed) {Zotero.openMainWindow(); return;}
    this.restoreWindow(win);
    win.focus();
  },
  restoreAll() {
    for(const [win,entry] of this.windows) {
      if(entry.hidden && !win.closed) {
        this.restoreWindow(win);
      }
    }
  },
  confirmExit(win) {
    if(!this.pref('cb_check_exit')) return true;
    return Services.prompt.confirm(win,'退出 Zotero','确定要关闭 Zotero 吗？退出后 Zotero 将不再后台运行。');
  },
  requestQuit() {
    if(!this.confirmExit(Zotero.getMainWindow())) return;
    this.quitting=true; Services.startup.quit(2); setTimeout(()=>{this.quitting=false;},1500);
  },
  handleClose(win) {
    if(this.pref('cb_minimize_on_button') && !this.quitting) this.minimize(win); else win.close();
  },
  onShortcut(win,type,event) {
    if(type==='w' && this.pref('cb_enable_ctrl_w') && win.Zotero_Tabs?.selectedID==='zotero-pane') {
      this.minimize(win); return;
    }
    if(type==='q' && this.pref('cb_enable_ctrl_q')) {this.minimize(win); return;}
    if(type==='w') {
      if(win.Zotero_Tabs?.selectedID!=='zotero-pane') win.Zotero_Tabs.close(win.Zotero_Tabs.selectedID);
      else win.ZoteroPane.handleClose(event);
    }
    if(type==='q') win.goQuitApplication(event || {ctrlKey:true});
  },
  addToWindow(win) {
    if(!win.ZoteroPane || this.windows.has(win)) return;
    const entry={saved:[],hidden:false,allowClose:false,originalClose:win.close,originalFocus:win.focus,
      hadBridge:Object.prototype.hasOwnProperty.call(win,'KeepZotero'),bridge:win.KeepZotero};
    this.windows.set(win,entry); win.KeepZotero=this;
    // Gecko's default command-line handler focuses the existing singleton window
    // when the pinned shortcut launches Zotero again. Show it before that focus.
    entry.focus= (...args)=>{
      if(this.backgroundStartup && entry.hidden) return;
      if(entry.hidden && !this.quitting) this.restoreWindow(win);
      return entry.originalFocus.apply(win,args);
    };
    win.focus=entry.focus;
    if(this.backgroundStartup) {
      entry.onStartupDisplay=()=>{if(this.backgroundStartup) this.hideStartupWindow(win);};
      win.addEventListener('load',entry.onStartupDisplay,true);
      win.addEventListener('resize',entry.onStartupDisplay,true);
      this.hideStartupWindow(win);
    }
    const set=(element,attribute,value)=>{
      if(!element) return;
      entry.saved.push({element,attribute,old:element.getAttribute(attribute),value});
      if(value===null) element.removeAttribute(attribute); else element.setAttribute(attribute,value);
    };
    const button=win.document.querySelector('.titlebar-close');
    set(button,'oncommand','KeepZotero.handleClose(window);');
    entry.onButton=event=>{
      if(event.type==='click' && event.button!==0) return;
      if(!event.target?.closest?.('.titlebar-close')) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.handleClose(win);
    };
    win.addEventListener('click',entry.onButton,true); win.addEventListener('command',entry.onButton,true);
    const closeKey=win.document.getElementById('key_close');
    set(closeKey,'command',null); set(closeKey,'oncommand',"KeepZotero.onShortcut(window,'w',event);");
    // Zotero disables its own Ctrl+Q key on Windows; supply a working binding.
    const keyset=win.document.createXULElement('keyset'); keyset.id='keepzotero-keyset';
    const qkey=win.document.createXULElement('key'); qkey.id='keepzotero-key-quit';
    qkey.setAttribute('key','q'); qkey.setAttribute('modifiers','accel');
    qkey.setAttribute('oncommand',"KeepZotero.onShortcut(window,'q',event);");
    keyset.append(qkey); win.document.documentElement.append(keyset); entry.keyset=keyset;
    entry.onNativeClose=event=>{
      if(this.quitting || entry.allowClose) return;
      if(this.pref('cb_enable_alt_f4')) {
        event.preventDefault(); event.stopImmediatePropagation(); this.minimize(win);
      } else if(!this.confirmExit(win)) {event.preventDefault(); event.stopImmediatePropagation();}
    };
    win.addEventListener('close',entry.onNativeClose,true);
    win.close=()=>{
      if(!this.quitting && !this.confirmExit(win)) return;
      entry.allowClose=true;
      try {entry.originalClose.call(win);} finally {setTimeout(()=>{entry.allowClose=false;},0);}
    };
  },
  addToAllWindows() {for(const win of Zotero.getMainWindows()) this.addToWindow(win);},
  removeFromWindow(win) {
    const entry=this.windows.get(win); if(!entry) return;
    if(entry.onStartupDisplay) {
      win.removeEventListener('load',entry.onStartupDisplay,true);
      win.removeEventListener('resize',entry.onStartupDisplay,true);
    }
    win.removeEventListener('click',entry.onButton,true); win.removeEventListener('command',entry.onButton,true);
    win.removeEventListener('close',entry.onNativeClose,true); entry.keyset?.remove();
    for(const {element,attribute,old,value} of entry.saved) {
      if(element.getAttribute(attribute)!==value) continue;
      if(old===null) element.removeAttribute(attribute); else element.setAttribute(attribute,old);
    }
    win.close=entry.originalClose;
    if(win.focus===entry.focus) win.focus=entry.originalFocus;
    if(entry.hadBridge) win.KeepZotero=entry.bridge; else delete win.KeepZotero;
    this.windows.delete(win);
  },
  cancelTrayMenu() {
    if(!this.trayInfo?.hwnd) return;
    const {ctypes:C}=ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
    const user=C.open('user32.dll');
    try {
      const post=user.declare('PostMessageW',C.winapi_abi,C.int32_t,C.voidptr_t,C.uint32_t,C.uintptr_t,C.intptr_t);
      post(C.cast(C.uintptr_t(this.trayInfo.hwnd),C.voidptr_t),0x1f,0,0);
    } finally {user.close();}
  },
  async shutdown() {
    this.backgroundStartup=false;
    this.unregisterRelaunchHandler();
    if(!this.quitting) this.restoreAll();
    for(const win of Array.from(this.windows.keys())) this.removeFromWindow(win);
    Services.obs.removeObserver(this.quitObserver,'quit-application-requested');
    Services.obs.removeObserver(this.quitObserver,'quit-application-granted');
    if(this.worker) {
      this.cancelTrayMenu();
      await new Promise(resolve=>{
        this.stopResolve=resolve; this.worker.postMessage({type:'stop'}); setTimeout(resolve,1000);
      });
      this.worker.terminate(); this.worker=null; this.trayReady=false;
    }
    if(this.native) {this.native.user.close(); this.native=null;}
  }
};
