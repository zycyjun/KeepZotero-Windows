/* Windows notification-area integration, running inside a Zotero ChromeWorker.
 * A tiny bundled DLL forwards sent shell callbacks into a posted event queue.
 * No external executable and no native-to-JavaScript window-procedure callbacks.
 */
var state = null;
var pumpTimer = null;

function start(exe,bridgePath) {
  const C = ctypes;
  const ABI = C.winapi_abi;
  const P = C.voidptr_t, U = C.uint32_t, I = C.int32_t;
  const W = C.jschar.ptr;
  const POINT = C.StructType('POINT', [{x:I},{y:I}]);
  const GUID = C.StructType('GUID', [{a:U},{b:C.uint16_t},{c:C.uint16_t},{d:C.uint8_t.array(8)}]);
  const MSG = C.StructType('MSG', [{hwnd:P},{message:U},{wParam:C.uintptr_t},{lParam:C.intptr_t},
    {time:U},{pt:POINT},{lPrivate:U}]);
  const WNDPROC = C.FunctionType(ABI, C.intptr_t, [P,U,C.uintptr_t,C.intptr_t]).ptr;
  const CLASS = C.StructType('WNDCLASSW', [{style:U},{proc:WNDPROC},{clsExtra:I},{wndExtra:I},
    {instance:P},{icon:P},{cursor:P},{background:P},{menuName:W},{className:W}]);
  const NID = C.StructType('NOTIFYICONDATAW', [{size:U},{hwnd:P},{id:U},{flags:U},{callback:U},
    {icon:P},{tip:C.jschar.array(128)},{state:U},{stateMask:U},{info:C.jschar.array(256)},
    {version:U},{infoTitle:C.jschar.array(64)},{infoFlags:U},{guid:GUID},{balloonIcon:P}]);
  const IID = C.StructType('NOTIFYICONIDENTIFIER', [{size:U},{hwnd:P},{id:U},{guid:GUID}]);
  const RECT = C.StructType('RECT', [{left:I},{top:I},{right:I},{bottom:I}]);
  const user=C.open('user32.dll'), shell=C.open('shell32.dll'), kernel=C.open('kernel32.dll'), bridge=C.open(bridgePath);
  const declare=(lib,name,result,...args)=>lib.declare(name,ABI,result,...args);
  const f={
    module:declare(kernel,'GetModuleHandleW',P,W),
    pid:declare(kernel,'GetCurrentProcessId',U),
    error:declare(kernel,'GetLastError',U),
    def:declare(bridge,'KeepZoteroWindowProc',C.intptr_t,P,U,C.uintptr_t,C.intptr_t),
    register:declare(user,'RegisterClassW',C.uint16_t,CLASS.ptr),
    unregister:declare(user,'UnregisterClassW',I,W,P),
    create:declare(user,'CreateWindowExW',P,U,W,W,U,I,I,I,I,P,P,P,P),
    destroy:declare(user,'DestroyWindow',I,P),
    peek:declare(user,'PeekMessageW',I,MSG.ptr,P,U,U,U),
    translate:declare(user,'TranslateMessage',I,MSG.ptr),
    dispatch:declare(user,'DispatchMessageW',C.intptr_t,MSG.ptr),
    registerMessage:declare(user,'RegisterWindowMessageW',U,W),
    extract:declare(shell,'ExtractIconExW',U,W,I,P.ptr,P.ptr,U),
    destroyIcon:declare(user,'DestroyIcon',I,P),
    notify:declare(shell,'Shell_NotifyIconW',I,U,NID.ptr),
    iconRect:declare(shell,'Shell_NotifyIconGetRect',I,IID.ptr,RECT.ptr),
    popup:declare(user,'CreatePopupMenu',P),
    append:declare(user,'AppendMenuW',I,P,U,C.uintptr_t,W),
    menuCount:declare(user,'GetMenuItemCount',I,P),
    menuText:declare(user,'GetMenuStringW',I,P,U,W,I,U),
    destroyMenu:declare(user,'DestroyMenu',I,P),
    cursor:declare(user,'GetCursorPos',I,POINT.ptr),
    foreground:declare(user,'SetForegroundWindow',I,P),
    track:declare(user,'TrackPopupMenu',U,P,U,I,I,I,P,P),
    post:declare(user,'PostMessageW',I,P,U,C.uintptr_t,C.intptr_t)
  };
  state={C,f,user,shell,kernel,bridge,MSG,NID,IID,RECT,POINT,hwnd:null,icon:null,added:false};
  state.instance=f.module(null);
  state.name=C.jschar.array()('KeepZoteroTray_'+f.pid());
  const wc=CLASS(); wc.style=8; wc.proc=f.def; wc.instance=state.instance; wc.className=state.name;
  if(!f.register(wc.address())) throw new Error('RegisterClassW: '+f.error());
  state.registered=true;
  state.hwnd=f.create(0,state.name,'KeepZotero notification window',0,0,0,0,0,null,null,state.instance,null);
  if(state.hwnd.isNull()) throw new Error('CreateWindowExW: '+f.error());
  const small=P();
  if(!f.extract(exe,0,null,small.address(),1) || small.isNull()) throw new Error('Could not read Zotero executable icon');
  state.icon=small;
  state.callback=0x8000+71;
  state.event=0x8000+72;
  state.taskbarCreated=f.registerMessage('TaskbarCreated');
  const nid=NID(); nid.size=NID.size; nid.hwnd=state.hwnd; nid.id=1;
  nid.flags=1|2|4; nid.callback=state.callback; nid.icon=state.icon;
  nid.tip=C.jschar.array(128)('Zotero — 双击打开，右键菜单');
  state.nid=nid;
  if(!f.notify(0,nid.address())) throw new Error('Shell_NotifyIconW: '+f.error()+'; NOTIFYICONDATAW size='+NID.size);
  state.added=true;
  const ident=IID(); ident.size=IID.size; ident.hwnd=state.hwnd; ident.id=1;
  const rect=RECT();
  const rectResult=f.iconRect(ident.address(),rect.address());
  postMessage({type:'ready',hwnd:String(C.cast(state.hwnd,C.uintptr_t).value),callback:state.callback,
    iconRegistered:true,iconRectResult:rectResult,nidSize:NID.size});
  pump();
}

function makeMenu() {
  const {f}=state;
  const menu=f.popup();
  if(menu.isNull()) throw new Error('CreatePopupMenu failed');
  f.append(menu,0,1,'打开 Zotero');
  f.append(menu,0x800,0,null);
  f.append(menu,0,2,'退出 Zotero');
  return menu;
}

function action(id) {
  if(id===1) postMessage({type:'open'});
  if(id===2) postMessage({type:'quit'});
}

function integer(value) {
  // Struct fields may already be Int64 values, while CData wraps them in .value.
  const raw=value?.value ?? value;
  return Number(raw.toString());
}

function showMenu() {
  const {f,POINT,hwnd}=state, pt=POINT(), menu=makeMenu();
  try {
    f.cursor(pt.address()); f.foreground(hwnd);
    const id=f.track(menu,0x100|0x80|2,pt.x,pt.y,0,hwnd,null);
    f.post(hwnd,0,0,0);
    action(id);
  } finally {f.destroyMenu(menu);}
}

function pump() {
  if(!state?.hwnd || state.hwnd.isNull()) return;
  const {f,MSG,hwnd}=state, msg=MSG();
  try {
    while(f.peek(msg.address(),hwnd,0,0,1)) {
      if(msg.message===state.event) {
        const mouse=integer(msg.lParam);
        if(mouse===0x203) action(1);
        if(mouse===0x205 || mouse===0x7b) showMenu();
      } else if(msg.message===0x111) {
        action(integer(msg.wParam)&0xffff);
      } else if(msg.message===state.taskbarCreated) {
        state.added=!!f.notify(0,state.nid.address());
        if(!state.added) postMessage({type:'error',message:'Explorer restarted but tray icon could not be restored'});
      } else {f.translate(msg.address()); f.dispatch(msg.address());}
    }
  } catch(e) {postMessage({type:'error',message:String(e)});}
  pumpTimer=setTimeout(pump,50);
}

function stop() {
  if(pumpTimer!==null) clearTimeout(pumpTimer);
  if(state) {
    const s=state;
    if(s.added) s.f.notify(2,s.nid.address());
    if(s.icon && !s.icon.isNull()) s.f.destroyIcon(s.icon);
    if(s.hwnd && !s.hwnd.isNull()) s.f.destroy(s.hwnd);
    if(s.registered) s.f.unregister(s.name,s.instance);
    s.bridge.close(); s.shell.close(); s.user.close(); s.kernel.close();
    state=null;
  }
}

onmessage=function(event) {
  try {
    if(event.data.type==='start') start(event.data.exe,event.data.bridge);
    if(event.data.type==='stop') {stop(); postMessage({type:'stopped'}); close();}
    if(event.data.type==='inspect-menu' && state) {
      const menu=makeMenu(), captions=[];
      try {
        for(let i=0;i<state.f.menuCount(menu);i++) {
          const text=ctypes.jschar.array(128)();
          state.f.menuText(menu,i,text,128,0x400);
          captions.push(text.readString());
        }
      } finally {state.f.destroyMenu(menu);}
      postMessage({type:'menu-info',captions});
    }
  } catch(e) {
    try {stop();} catch(_) {}
    postMessage({type:'error',message:String(e),stack:e.stack});
  }
};
