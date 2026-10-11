/* Current-user Windows logon startup; no helper process or administrator rights. */
KeepZotero_Autostart = {
  prefName:'extensions.keepzotero.cb_start_with_windows',
  registryPath:'Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  updating:false, error:null,
  profile() {return Services.dirsvc.get('ProfD',Components.interfaces.nsIFile).path;},
  valueName() {
    let hash=2166136261;
    for(const character of this.profile().toLowerCase()) hash=Math.imul(hash^character.charCodeAt(0),16777619)>>>0;
    return 'Zotero (KeepZotero '+hash.toString(16).padStart(8,'0')+')';
  },
  command() {
    const exe=Services.dirsvc.get('XREExeF',Components.interfaces.nsIFile).path;
    const command='"'+exe+'" -profile "'+this.profile()+'" -keepzotero-background';
    if(command.length>260) throw new Error('Zotero 或配置目录路径过长，无法添加 Windows 启动项。');
    return command;
  },
  key() {
    return Components.classes['@mozilla.org/windows-registry-key;1']
      .createInstance(Components.interfaces.nsIWindowsRegKey);
  },
  read() {
    if(!Zotero.isWin) return null;
    const key=this.key(),Ci=Components.interfaces.nsIWindowsRegKey;
    try {
      try {key.open(Ci.ROOT_KEY_CURRENT_USER,this.registryPath,Ci.ACCESS_READ);} catch(_) {return null;}
      return key.hasValue(this.valueName()) ? key.readStringValue(this.valueName()) : null;
    } finally {key.close();}
  },
  set(enabled) {
    if(!Zotero.isWin) return;
    if(!enabled) {this.remove(); return;}
    const command=this.command();
    if(this.read()===command) return;
    const key=this.key(),Ci=Components.interfaces.nsIWindowsRegKey;
    try {
      key.create(Ci.ROOT_KEY_CURRENT_USER,this.registryPath,Ci.ACCESS_READ|Ci.ACCESS_WRITE);
      key.writeStringValue(this.valueName(),command);
      if(key.readStringValue(this.valueName())!==command) throw new Error('Windows 启动项写入验证失败。');
    } finally {key.close();}
  },
  remove() {
    if(!Zotero.isWin || this.read()===null) return;
    const key=this.key(),Ci=Components.interfaces.nsIWindowsRegKey;
    try {
      key.open(Ci.ROOT_KEY_CURRENT_USER,this.registryPath,Ci.ACCESS_READ|Ci.ACCESS_WRITE);
      if(key.hasValue(this.valueName())) key.removeValue(this.valueName());
    } finally {key.close();}
  },
  sync(reportError=false) {
    if(this.updating || !Zotero.isWin) return;
    try {
      const enabled=!!Zotero.Prefs.get(this.prefName,true);
      this.set(enabled); this.lastEnabled=enabled; this.error=null;
    } catch(e) {
      this.error=String(e); Zotero.logError(e);
      this.updating=true;
      try {Zotero.Prefs.set(this.prefName,!!this.lastEnabled,true);} finally {this.updating=false;}
      if(reportError) Services.prompt.alert(Zotero.getMainWindow(),'开机自启动','无法更新 Windows 启动项：\n'+this.error);
    }
  },
  init() {
    if(!Zotero.isWin) return;
    this.lastEnabled=this.read()!==null;
    this.observer={observe:()=>this.sync(true)};
    Services.prefs.addObserver(this.prefName,this.observer);
    this.sync();
  },
  shutdown(reason) {
    if(this.observer) {Services.prefs.removeObserver(this.prefName,this.observer); this.observer=null;}
    // Keep the entry during normal application exit or an upgrade.
    if(reason===4 || reason===6) this.remove();
  }
};
