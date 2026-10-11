var KeepZotero;
var KeepZotero_Autostart;
var keepZoteroChromeHandle;

function log(msg) {
	Zotero.debug("KeepZotero: " + msg);
}

function install() {
	log("Installed KeepZotero");
}

async function startup({ id, version, rootURI }, reason) {
	log("Starting KeepZotero");
	const aom = Components.classes['@mozilla.org/addons/addon-manager-startup;1']
		.getService(Components.interfaces.amIAddonManagerStartup);
	keepZoteroChromeHandle = aom.registerChrome(Services.io.newURI(rootURI + 'manifest.json'),
		[['content', 'keepzotero-tray', 'content/']]);
	
	Zotero.PreferencePanes.register({
		pluginID: 'keepzotero@yhmtsai',
		src: rootURI + 'preferences.xhtml',
		scripts: [rootURI + 'preferences.js']
	});
	
	Services.scriptloader.loadSubScriptWithOptions(rootURI + 'keepzotero-native.js', {
		target: this,
		ignoreCache: true
	});
	Services.scriptloader.loadSubScriptWithOptions(rootURI + 'autostart.js', {
		target: this,
		ignoreCache: true
	});
  KeepZotero_Autostart.init();
	KeepZotero.autostart = KeepZotero_Autostart;
	await KeepZotero.init({ id, version, rootURI, reason });
	KeepZotero.addToAllWindows();
}

function onMainWindowLoad({ window }) {
	KeepZotero?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
	KeepZotero?.removeFromWindow(window);
}

async function shutdown(data, reason) {
	log("Shutting down");
	try { await KeepZotero?.shutdown(); }
	finally { KeepZotero_Autostart?.shutdown(reason); }
	keepZoteroChromeHandle?.destruct();
	keepZoteroChromeHandle = undefined;
	KeepZotero = undefined;
}

function uninstall({ rootURI }) {
	log("Uninstalled");
	if (!KeepZotero_Autostart) {
		Services.scriptloader.loadSubScriptWithOptions(rootURI + 'autostart.js', {
			target: this, ignoreCache: true
		});
	}
	KeepZotero_Autostart.remove();
}
